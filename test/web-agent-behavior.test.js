"use strict";

// Comportamiento de la versión web corregida (2026-11-09):
//  - verifyModel REAL contra el ai-proxy (sin stub de éxito falso).
//  - Compuerta anti-narración en el agente web (la regla del kernel, Entrega 1.1).
//  - Proyecto automático en la primera tarea de agente sin proyecto abierto.
//  - Contratos estáticos del retiro del sistema legado del portal.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const AGENT = fs.readFileSync(path.join(ROOT, "web-portal", "js", "web-agent.js"), "utf8");
const BRIDGE = fs.readFileSync(path.join(ROOT, "web-portal", "js", "web-ide-bridge.js"), "utf8");
const APPJS = fs.readFileSync(path.join(ROOT, "web-portal", "app.js"), "utf8");
const INDEX = fs.readFileSync(path.join(ROOT, "web-portal", "index.html"), "utf8");
const RENDERER = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");

// ─── Utilidades SSE: un "spec" {text} | {tool, args} | {status, code} | {networkError}
// se convierte en la respuesta en streaming que devuelve el ai-proxy real.
function specToEvents(spec) {
  const events = [];
  if (spec.text) events.push({ choices: [{ delta: { content: spec.text } }] });
  if (spec.tool) events.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: spec.tool, arguments: JSON.stringify(spec.args || {}) } }] } }] });
  events.push({ choices: [{ delta: {}, finish_reason: spec.tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  return events;
}

function readerFromString(str) {
  const bytes = new TextEncoder().encode(str);
  let sent = false;
  return { read: async () => (sent ? { value: undefined, done: true } : (sent = true, { value: bytes, done: false })) };
}

function loadAgent({ respond, ensuredProject = null } = {}) {
  const bodies = [];
  const fetchMock = async (_url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    bodies.push(body);
    const spec = respond(bodies.length - 1, body);
    if (!spec) throw new Error("sin respuesta programada para la llamada");
    if (spec.networkError) throw new Error("socket hang up");
    if (spec.status && spec.status !== 200) {
      return { ok: false, status: spec.status, json: async () => ({ error: { code: spec.code || "SERVER", message: spec.message || "error del servidor" } }), body: { getReader: () => readerFromString("") } };
    }
    const payload = specToEvents(spec).map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
    return { ok: true, status: 200, json: async () => null, body: { getReader: () => readerFromString(payload) } };
  };
  const store = new Map();
  const fsMock = {
    read: async (root, p) => { const k = `${root}|${p}`; if (!store.has(k)) throw new Error(`No existe: ${p}`); return { path: p, content: store.get(k) }; },
    write: async (root, p, content) => { store.set(`${root}|${p}`, String(content)); return { path: p }; },
    remove: async (root, p) => { store.delete(`${root}|${p}`); },
    list: async () => [],
    all: async (root) => { const out = {}; for (const [k, v] of store) if (k.startsWith(`${root}|`)) out[k.slice(root.length + 1)] = v; return out; },
    notify: () => {},
    relFromAny: (_root, value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, ""),
  };
  const win = {
    EditCoreCuentas: { listModels: async () => ["claude-sonnet-4.6"], getAccessToken: async () => "tok" },
    EDITCOREAI_CUENTAS: { url: "https://cuentas.test", anonKey: "anon-de-pruebas" },
    EditCoreWebFs: fsMock,
    EditCoreWebBridge: {
      notifyBalance: () => {},
      ...(ensuredProject ? { ensureProjectForAgent: async () => ensuredProject } : {}),
    },
    editcoreProject: { assessConnections: async () => ({ connections: {}, readyToPublish: false }) },
    dispatchEvent: () => {},
  };
  win.window = win;
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const sandbox = {
    window: win, fetch: fetchMock, TextDecoder, TextEncoder, AbortController, CustomEvent,
    setTimeout, clearTimeout, Date, JSON, Math, Number, String, Boolean, Array, Object, Map, Set, RegExp, Promise, Error, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(AGENT, sandbox);
  const progressEvents = [];
  win.editcoreAgent.onProgress((p) => progressEvents.push(p));
  return { win, store, bodies, progressEvents };
}

// ─── 1. verifyModel real ────────────────────────────────────────────────────

test("web verifyModel: chat y herramientas reales contra el ai-proxy", async () => {
  const { win } = loadAgent({ respond: (i) => (i === 0 ? { text: "OK" } : { tool: "list_files", args: { path: "" } }) });
  const res = await win.editcoreAgent.verifyModel({ model: "claude-sonnet-4.6" });
  assert.equal(res.chatOK, true);
  assert.equal(res.toolOK, true);
  assert.equal(res.model, "claude-sonnet-4.6");
});

test("web verifyModel: si el modelo no emite herramientas, toolOK es falso con motivo", async () => {
  const { win } = loadAgent({ respond: () => ({ text: "OK" }) });
  const res = await win.editcoreAgent.verifyModel({ model: "claude-sonnet-4.6" });
  assert.equal(res.chatOK, true);
  assert.equal(res.toolOK, false);
  assert.match(res.toolError || "", /herramientas/);
});

test("web verifyModel: error de red baja ambas banderas sin colgarse ni mentir", async () => {
  const { win } = loadAgent({ respond: () => ({ networkError: true }) });
  const res = await win.editcoreAgent.verifyModel({ model: "claude-sonnet-4.6" });
  assert.equal(res.chatOK, false);
  assert.equal(res.toolOK, false);
  assert.ok(res.error, "debe traer el motivo");
});

test("web verifyModel: saldo insuficiente (402) se reporta, no se disfraza de éxito", async () => {
  const { win } = loadAgent({ respond: () => ({ status: 402, code: "OUT_OF_CREDITS" }) });
  const res = await win.editcoreAgent.verifyModel({ model: "claude-sonnet-4.6" });
  assert.equal(res.chatOK, false);
  assert.match(res.error || "", /saldo/i);
});

// ─── 2. Compuerta anti-narración ────────────────────────────────────────────

test("web agente: narrar sin ejecutar empuja una vez y luego el modelo ejecuta", async () => {
  const script = [
    { text: "Sigue leyendo el archivo para ver si hay lógica implementada." },
    { tool: "write_file", args: { path: "status.txt", content: "ok" } },
    { text: "Listo: creé status.txt." },
  ];
  const { win, store, bodies } = loadAgent({ respond: (i) => script[i] });
  const res = await win.editcoreAgent.run({ runId: "r-narra", projectRoot: "/proyectos/demo", prompt: "crea status.txt", permissionMode: "full", allowWrite: true });
  assert.equal(res.ok, true);
  assert.equal(store.get("/proyectos/demo|status.txt"), "ok");
  const lastMsg = bodies[1].messages[bodies[1].messages.length - 1];
  assert.match(JSON.stringify(lastMsg.content), /No cierres el turno narrando/);
  assert.equal(res.report.completed, true);
});

test("web agente: si el modelo insiste en narrar, el cierre es honesto y nada se escribió", async () => {
  const script = [
    { text: "Sigue leyendo el archivo para ver si hay lógica implementada." },
    { text: "Ahora voy a crear el archivo que pediste." },
  ];
  const { win, store } = loadAgent({ respond: (i) => script[i] });
  const res = await win.editcoreAgent.run({ runId: "r-insiste", projectRoot: "/proyectos/demo", prompt: "crea status.txt", permissionMode: "full", allowWrite: true });
  assert.equal(res.report.completed, false);
  assert.equal(res.report.stopReason, "narration_without_action");
  assert.match(res.text, /No ejecuté ninguna acción/);
  assert.equal(store.size, 0);
});

// ─── 3. Proyecto automático ─────────────────────────────────────────────────

test("web agente: sin proyecto abierto, crea uno y la tarea escribe dentro", async () => {
  const ensured = { root: "/proyectos/una-tienda", name: "Una tienda", created: true };
  const script = [
    { tool: "write_file", args: { path: "status.txt", content: "ok" } },
    { text: "Listo." },
  ];
  const { win, store, progressEvents } = loadAgent({ ensuredProject: ensured, respond: (i) => script[i] });
  const res = await win.editcoreAgent.run({ runId: "r-auto", projectRoot: "", prompt: "crea una tienda", permissionMode: "full", allowWrite: true });
  assert.equal(res.ok, true);
  assert.equal(store.get("/proyectos/una-tienda|status.txt"), "ok");
  assert.ok(progressEvents.some((p) => p.phase === "startup" && /Creé el proyecto/.test(p.text || "")));
  assert.equal(res.report.autoCreatedProject.name, "Una tienda");
});

function loadBridgeOnly() {
  const data = new Map();
  const ls = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  ls.setItem("editcoreai_web_session", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 9007199254740991, user: { id: "u1", email: "ana@gmail.com" } }));
  const win = {
    EditCoreCuentas: {
      isConfigured: () => true, hasSession: () => true,
      sessionUser: () => ({ id: "u1", email: "ana@gmail.com" }),
      completeLoginFromUrl: async () => null, account: async () => null,
      rpc: async () => ({}), listModels: async () => [], logout: async () => {},
    },
    localStorage: ls,
    location: { pathname: "/app.html", search: "", href: "http://localhost/app.html", origin: "http://localhost" },
    addEventListener: () => {}, dispatchEvent: () => true,
    __EDITCORE_PRELOAD_API: {},
  };
  win.window = win;
  class Document { createElement() { return { style: {} }; } }
  const sandbox = {
    window: win,
    document: { addEventListener: () => {}, querySelectorAll: () => [], documentElement: { classList: { add: () => {} } } },
    Document, MutationObserver: class { observe() {} },
    queueMicrotask, localStorage: ls, location: win.location,
    URL, Event: class {}, CustomEvent: class {},
    Promise, Error, JSON, Math, Number, String, Boolean, Array, Object, Map, Set, Date, RegExp,
    setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent,
    crypto: require("node:crypto").webcrypto,
  };
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE, sandbox);
  return { win };
}

test("web puente: ensureProjectForAgent crea con la plantilla, deriva el nombre y reusa el proyecto", async () => {
  const { win } = loadBridgeOnly();
  const first = await win.EditCoreWebBridge.ensureProjectForAgent("crea una tienda de ropa para vender en línea");
  assert.equal(first.created, true);
  assert.equal(first.root, "/proyectos/una-tienda-de-ropa-para-vender");
  assert.equal(first.name, "Una tienda de ropa para vender");
  const files = await win.EditCoreWebFs.all(first.root);
  assert.ok(files["index.html"], "la plantilla STARTER debe crear index.html");
  const second = await win.EditCoreWebBridge.ensureProjectForAgent("otra tarea distinta");
  assert.equal(second.created, false);
  assert.equal(second.root, first.root);
});

test("web puente: sin pedido legible el proyecto se llama Mi proyecto", async () => {
  const { win } = loadBridgeOnly();
  const res = await win.EditCoreWebBridge.ensureProjectForAgent("");
  assert.equal(res.created, true);
  assert.equal(res.name, "Mi proyecto");
});

// ─── 4. Contratos estáticos del retiro ──────────────────────────────────────

test("web portal: el motor de cuentas legado salió de app.js y de la landing", () => {
  assert.doesNotMatch(APPJS, /supabase\.gafcore\.com/);
  assert.doesNotMatch(APPJS, /signInWithPassword/);
  assert.doesNotMatch(APPJS, /rest\/v1\/profiles/);
  assert.doesNotMatch(APPJS, /\/api\/create-checkout/);
  assert.match(APPJS, /EditCoreCuentas/);
  assert.match(APPJS, /createCheckout/);
  assert.doesNotMatch(INDEX, /@supabase\/supabase-js/);
  assert.doesNotMatch(INDEX, /authPassword/);
  assert.match(INDEX, /authGoogleBtn/);
});

test("web: el stub de verifyModel y la ausencia de compuerta quedaron atrás", () => {
  assert.doesNotMatch(AGENT, /chatOK: true, toolOK: true/);
  assert.match(AGENT, /looksLikePromiseWithoutAction/);
  assert.match(AGENT, /narration_without_action/);
  assert.match(AGENT, /ensureProjectForAgent/);
  assert.match(RENDERER, /EDITCORE_IS_WEB && typeof window\.EditCoreWebBridge\?\.ensureProjectForAgent/);
});
