// Puente web del IDE: /app carga el mismo index.html y los mismos scripts de la app de escritorio, y este
// archivo les da lo que en escritorio da Electron (preload.js): sesión, saldo, proyectos y archivos, vista
// previa, modelos y agente. Los proyectos de la web viven en el navegador de cada cuenta (IndexedDB).
// Lo que solo existe en escritorio (terminal, git local, carpetas del disco, Inspector…) responde "no disponible"
// y sus botones se ocultan con css/web-ide-shell.css.
(function () {
  "use strict";

  const C = window.EditCoreCuentas;
  const WEB_ONLY_DESKTOP = "Disponible solo en la app de escritorio de EditCoreAI.";
  const CATALOG = "/proyectos";
  const PREVIEW_PREFIX = "/preview/";

  window.EDITCORE_IS_WEB = true;
  window.EDITCORE_WEB_CATALOG = CATALOG;
  document.documentElement.classList.add("is-web");
  document.addEventListener("DOMContentLoaded", () => document.body?.classList.add("is-web"));

  const emitTo = (set, payload) => set.forEach((fn) => { try { fn(payload); } catch (error) { console.warn("[web-ide]", error); } });
  const listen = (set) => (cb) => {
    if (typeof cb !== "function") return () => {};
    set.add(cb);
    return () => set.delete(cb);
  };
  const uuid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // ── 1. Todo lo de preload.js existe: lo que la web no implementa responde "no disponible" ──
  const unavailable = async () => ({ ok: false, success: false, available: false, webUnavailable: true, error: WEB_ONLY_DESKTOP });
  for (const [ns, methods] of Object.entries(window.__EDITCORE_PRELOAD_API || {})) {
    const target = {};
    for (const name of methods) target[name] = /^on[A-Z]/.test(name) ? () => () => {} : unavailable;
    window[ns] = target;
  }
  const ns = (name, impl) => { window[name] = Object.assign(window[name] || {}, impl); };

  // ── 2. Sesión con Google, saldo y administración (mismo servidor que la app) ──
  let account = null;
  let loginError = "";
  const sessionListeners = new Set();
  const blockedListeners = new Set();
  const balanceListeners = new Set();

  const ready = (async () => {
    if (!C) return;
    try { await C.completeLoginFromUrl(); } catch (error) {
      loginError = error?.message || "No se pudo completar el inicio de sesión con Google.";
    }
  })();

  function publicSession() {
    if (!C?.isConfigured?.()) return { isAuthenticated: false, user: null, configured: false };
    if (!C.hasSession()) return { isAuthenticated: false, user: null, configured: true, error: loginError || undefined };
    const u = C.sessionUser();
    const acc = account || {};
    const role = acc.role === "admin" ? "admin" : "user";
    return {
      isAuthenticated: true,
      configured: true,
      user: {
        id: u.id,
        email: acc.email || u.email,
        name: u.name || acc.email || u.email,
        avatarUrl: u.avatarUrl || "",
        role,
        isAdmin: role === "admin" && acc.status === "active",
        status: acc.status || "unknown",
        plan: acc.plan || "free",
        credits_balance: Number(acc.credits_balance || 0),
        topup_base: Number(acc.topup_base || 0),
        is_unlimited: Boolean(acc.is_unlimited),
      },
    };
  }

  const webAuth = {
    get account() { return account; },
    set account(value) { account = value && typeof value === "object" ? value : account; },
    isAuthenticated: () => Boolean(C?.hasSession?.()),
    rpc: (fn, args) => C.rpc(fn, args),
    meaiBalance: () => C.meaiBalance(),
    async refreshAccount() {
      const acc = await C.account();
      account = acc && typeof acc === "object" ? acc : null;
      return account;
    },
  };

  ns("editcoreAuth", {
    async getSession(options = {}) {
      await ready;
      if (!C?.isConfigured?.() || !C.hasSession()) return publicSession();
      if (options.refresh || !account) {
        try {
          await webAuth.refreshAccount();
        } catch (error) {
          if (error?.code === "NO_SESSION" || error?.code === "SESSION_EXPIRED") return publicSession();
          if (!account) throw error;
        }
      }
      return publicSession();
    },
    async loginWithGoogle() {
      try {
        await C.startGoogleLogin("/app.html");
        return new Promise(() => {});
      } catch (error) {
        return { success: false, code: error?.code || "SERVER", error: error?.message || String(error) };
      }
    },
    async cancelLogin() { return { ok: true }; },
    async logout() {
      window.EditCoreWebAgent?.cancelAll?.();
      await C.logout();
      account = null;
      emitTo(sessionListeners, publicSession());
      return { ok: true };
    },
    async checkAccess() { return { allowed: true }; },
    onSessionChanged: listen(sessionListeners),
    onBlocked: listen(blockedListeners),
  });

  class MiniEmitter {
    constructor() { this._handlers = new Map(); }
    on(name, fn) { (this._handlers.get(name) || this._handlers.set(name, new Set()).get(name)).add(fn); return this; }
    off(name, fn) { this._handlers.get(name)?.delete(fn); return this; }
    once(name, fn) { const wrap = (...a) => { this.off(name, wrap); fn(...a); }; return this.on(name, wrap); }
    emit(name, ...args) { const set = this._handlers.get(name); if (!set) return false; set.forEach((fn) => fn(...args)); return true; }
  }
  window.__editcoreWebRequire = (name) => {
    if (name === "node:events" || name === "events") return { EventEmitter: MiniEmitter };
    if (name === "./auth-manager") return { authManager: webAuth };
    throw new Error(`Módulo no disponible en la web: ${name}`);
  };

  let ledgerInstance = null;
  function ledger() {
    if (ledgerInstance) return ledgerInstance;
    const mod = window.__editcoreCreditLedgerModule?.exports;
    if (!mod?.CreditLedger) throw new Error("No se cargó el módulo de saldo.");
    ledgerInstance = new mod.CreditLedger({ auth: webAuth });
    ledgerInstance.on("balance-changed", (view) => emitTo(balanceListeners, view));
    return ledgerInstance;
  }
  const safe = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return { ok: false, success: false, canExecute: false, code: error?.code || "SERVER", error: error?.message || String(error) };
    }
  };
  function isMercadoPagoCheckoutUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && /(^|\.)mercadopago\.com(\.[a-z]{2})?$|(^|\.)mercadolibre\.com$|^mpago\.(la|li)$/i.test(url.hostname);
    } catch {
      return false;
    }
  }
  // Con "noopener" window.open siempre devuelve null aunque abra la pestaña; por eso se corta el opener a mano.
  function openPayment(url) {
    const win = window.open(url, "_blank");
    if (!win) return location.assign(url);
    try { win.opener = null; } catch { /* ignore */ }
  }
  async function notifyBalance() {
    try {
      const view = await ledger().getBalance();
      if (view?.ok !== false) emitTo(balanceListeners, view);
    } catch { /* ignore */ }
  }

  ns("editcoreCredits", {
    getBalance: safe(() => ledger().getBalance()),
    redeem: safe((code) => ledger().redeemVoucher(code)),
    transactions: safe((limit) => ledger().listTransactions(limit)),
    getPacks: safe(() => ledger().getPacks()),
    calculateUsage: safe((model, i, o) => ledger().calculateUsageCredits(model, i, o)),
    adminOverview: safe(() => ledger().adminOverview()),
    adminListUsers: safe((search) => ledger().adminListUsers(search)),
    adminMeaiBalance: safe(() => ledger().adminMeaiBalance()),
    adminMeaiTopup: safe((payload) => ledger().adminMeaiTopup(payload || {})),
    adminMeaiSetBalance: safe((payload) => ledger().adminMeaiSetBalance(payload || {})),
    adminMeaiDeleteTopup: safe((id) => ledger().adminMeaiDeleteTopup(id)),
    adminSetMarkup: safe((markup) => ledger().adminSetMarkup(markup)),
    fxRate: safe((currency) => ledger().fxRateUsd(currency)),
    adminCreateVoucher: safe((payload) => ledger().adminCreateVoucher(payload || {})),
    adminGrant: safe((payload) => ledger().adminGrantCredits(payload || {})),
    adminSetStatus: safe((payload) => ledger().adminSetStatus(payload || {})),
    adminPayments: safe(() => ledger().adminPayments()),
    adminSetTopup: safe((payload) => ledger().adminSetTopup(payload || {})),
    adminSetPaymentLink: safe((payload) => ledger().adminSetPaymentLink(payload || {})),
    adminSetSignupBonus: safe((payload) => ledger().adminSetSignupBonus(payload || {})),
    cloudModels: safe(async () => ({ ok: true, models: await C.listModels(), baseUrl: `${String(window.EDITCOREAI_CUENTAS?.url || "").replace(/\/+$/, "")}/functions/v1/ai-proxy/v1` })),
    topupOffer: safe(() => C.paymentOffer()),
    checkout: safe(async () => {
      const res = await C.createCheckout();
      if (!isMercadoPagoCheckoutUrl(res?.url)) return { ok: false, error: "Enlace de pago inválido." };
      openPayment(res.url);
      return { ok: true, amount: res.amount, currency: res.currency, creditUsd: res.creditUsd };
    }),
    openPaymentLink: safe(async () => {
      const offer = await C.paymentOffer();
      if (!offer?.ok || !isMercadoPagoCheckoutUrl(offer.payment_link)) return { ok: false, error: "No hay link de pago configurado." };
      openPayment(offer.payment_link);
      return { ok: true, amount: offer.price, currency: offer.currency, contact: offer.contact || "" };
    }),
    onBalanceChanged: listen(balanceListeners),
  });

  // ── 3. Almacenamiento por cuenta: IndexedDB con copia en memoria ──
  const uidNow = () => (C?.hasSession?.() ? C.sessionUser().id || "anon" : "anon");
  const DB_NAME = "editcoreai-web";
  const dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  const memory = new Map();
  async function kvGet(key) {
    const full = `${uidNow()}|${key}`;
    if (memory.has(full)) return memory.get(full);
    const db = await dbPromise;
    const value = db ? await new Promise((resolve) => {
      const req = db.transaction("kv").objectStore("kv").get(full);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    }) : null;
    memory.set(full, value);
    return value;
  }
  async function kvSet(key, value) {
    const full = `${uidNow()}|${key}`;
    memory.set(full, value);
    const db = await dbPromise;
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      if (value === null || value === undefined) tx.objectStore("kv").delete(full);
      else tx.objectStore("kv").put(value, full);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }
  async function kvKeys(prefix) {
    const db = await dbPromise;
    const start = `${uidNow()}|${prefix}`;
    if (!db) return [...memory.keys()].filter((k) => k.startsWith(start)).map((k) => k.slice(uidNow().length + 1));
    return new Promise((resolve) => {
      const req = db.transaction("kv").objectStore("kv").getAllKeys(IDBKeyRange.bound(start, `${start}\uffff`));
      req.onsuccess = () => resolve((req.result || []).map((k) => String(k).slice(uidNow().length + 1)));
      req.onerror = () => resolve([]);
    });
  }

  const SESSION_FLUSH_KEY = () => `editcore-web-session-flush:${uidNow()}`;
  ns("editcoreSession", {
    async load() {
      const stored = await kvGet("session");
      let flushed = null;
      try { flushed = JSON.parse(localStorage.getItem(SESSION_FLUSH_KEY()) || "null"); } catch { flushed = null; }
      if (flushed && (!stored || Number(flushed.savedAt || 0) >= Number(stored.savedAt || 0))) return flushed;
      return stored;
    },
    async save(payload = {}) {
      await kvSet("session", { ...payload, savedAt: Date.now() });
      try { localStorage.removeItem(SESSION_FLUSH_KEY()); } catch { /* ignore */ }
      return { ok: true };
    },
    flushSync(payload = {}) {
      try {
        localStorage.setItem(SESSION_FLUSH_KEY(), JSON.stringify({ ...payload, savedAt: Date.now() }));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    },
    async saveProjectChats(input = {}) {
      const root = normRoot(input.projectRoot);
      if (!root) return { ok: false };
      await kvSet(`chats|${root}`, { ...input, savedAt: Date.now() });
      return { ok: true };
    },
    async loadProjectChats(input = {}) {
      const root = normRoot(input.projectRoot);
      return root ? kvGet(`chats|${root}`) : null;
    },
    onPleaseFlush(cb) {
      if (typeof cb !== "function") return () => {};
      const handler = () => { try { cb(); } catch { /* ignore */ } };
      window.addEventListener("pagehide", handler);
      return () => window.removeEventListener("pagehide", handler);
    },
  });

  ns("editcoreSecureConfig", {
    async load() { return (await kvGet("secure-config")) || {}; },
    async save(value) { await kvSet("secure-config", value || {}); return { ok: true }; },
  });

  // ── 4. Proyectos y archivos (cada proyecto: /proyectos/<nombre>) ──
  const filesListeners = new Set();
  const previewListeners = new Set();
  const projectProgressListeners = new Set();

  function normRoot(root) {
    return String(root || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  }
  function slugify(name) {
    return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "proyecto";
  }
  function cleanRel(rel) {
    const value = String(rel || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "").trim();
    if (value.split("/").some((part) => part === "..")) throw new Error("Ruta inválida.");
    return value === "." ? "" : value;
  }
  function relFromAny(root, value) {
    const r = normRoot(root);
    let p = String(value || "").replace(/\\/g, "/").trim();
    if (r && p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) p = p.slice(r.length + 1);
    else if (r && p.toLowerCase() === r.toLowerCase()) p = "";
    return cleanRel(p);
  }
  async function projectIndex() {
    return (await kvGet("projects")) || [];
  }
  async function saveProjectIndex(list) {
    await kvSet("projects", list);
  }
  async function readFs(root) {
    const data = await kvGet(`fs|${normRoot(root)}`);
    return data && typeof data === "object" ? { files: data.files || {}, dirs: data.dirs || [] } : { files: {}, dirs: [] };
  }
  async function writeFs(root, fsData) {
    await kvSet(`fs|${normRoot(root)}`, { files: fsData.files, dirs: [...new Set(fsData.dirs)] });
  }
  function notifyFiles(root, changed = []) {
    const projectRoot = normRoot(root);
    emitTo(filesListeners, { projectRoot, root: projectRoot, changedFiles: changed, files: changed });
    emitTo(previewListeners, { projectRoot, root: projectRoot, url: previewUrlFor(projectRoot), reason: "files-changed" });
  }
  function previewUrlFor(root) {
    const slug = normRoot(root).split("/").pop() || "proyecto";
    return `${location.origin}${PREVIEW_PREFIX}${encodeURIComponent(slug)}/index.html`;
  }

  async function fsWrite(root, rel, content) {
    const path = cleanRel(rel);
    if (!path) throw new Error("Falta la ruta del archivo.");
    const data = await readFs(root);
    const before = Object.prototype.hasOwnProperty.call(data.files, path) ? data.files[path] : null;
    data.files[path] = String(content ?? "");
    await writeFs(root, data);
    return { path, before, created: before === null };
  }
  async function fsRead(root, rel) {
    const path = cleanRel(rel);
    const data = await readFs(root);
    if (Object.prototype.hasOwnProperty.call(data.files, path)) return { path, content: data.files[path] };
    const lower = path.toLowerCase();
    const found = Object.keys(data.files).find((key) => key.toLowerCase() === lower);
    if (found) return { path: found, content: data.files[found] };
    throw new Error(`No existe el archivo: ${path}`);
  }
  async function fsDelete(root, rel) {
    const path = cleanRel(rel);
    const data = await readFs(root);
    let removed = 0;
    for (const key of Object.keys(data.files)) {
      if (key === path || key.startsWith(`${path}/`)) { delete data.files[key]; removed += 1; }
    }
    data.dirs = data.dirs.filter((d) => d !== path && !d.startsWith(`${path}/`));
    await writeFs(root, data);
    return removed;
  }
  async function fsList(root, rel = "") {
    const base = cleanRel(rel);
    const data = await readFs(root);
    const prefix = base ? `${base}/` : "";
    const rows = new Map();
    const add = (name, kind) => {
      const path = prefix + name;
      if (!rows.has(path) || kind === "directory") {
        rows.set(path, { name, path, absolutePath: `${normRoot(root)}/${path}`, kind });
      }
    };
    for (const key of Object.keys(data.files)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const [first, ...more] = rest.split("/");
      if (first) add(first, more.length ? "directory" : "file");
    }
    for (const dir of data.dirs) {
      if (!dir.startsWith(prefix)) continue;
      const first = dir.slice(prefix.length).split("/")[0];
      if (first) add(first, "directory");
    }
    return [...rows.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  }

  const STARTER = (name) => ({
    "index.html": `<!doctype html>\n<html lang="es">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>${name}</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n  <main class="app">\n    <h1>${name}</h1>\n    <p>Proyecto listo. Pide a EditCoreAI lo que quieres construir.</p>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>\n`,
    "styles.css": "* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; background: #f7f8fb; color: #1f2430; }\n.app { max-width: 880px; margin: 64px auto; padding: 0 24px; }\n",
    "app.js": "// Lógica de la app\n",
  });

  async function createProject(name) {
    const title = String(name || "").trim().slice(0, 80) || "Proyecto";
    const list = await projectIndex();
    let slug = slugify(title);
    const taken = new Set(list.map((p) => p.slug));
    for (let i = 2; taken.has(slug); i += 1) slug = `${slugify(title)}-${i}`;
    const root = `${CATALOG}/${slug}`;
    list.push({ name: title, slug, root, createdAt: Date.now() });
    await saveProjectIndex(list);
    await writeFs(root, { files: STARTER(title), dirs: [] });
    return { root, name: title };
  }

  async function findProjectBySlug(slug) {
    const list = await projectIndex();
    return list.find((p) => p.slug === slug) || null;
  }

  ns("editcore", {
    async closeWorkspace() { return { ok: true }; },
    async openWorkspace(targetPath) { return { ok: true, root: normRoot(targetPath) }; },
    async switchProject(options = {}) { return { ok: true, ...options }; },
  });

  ns("editcoreProject", {
    async pick() { return null; },
    async pickParent() { return CATALOG; },
    async create(input = {}) {
      const created = await createProject(input.name);
      return { ok: true, root: created.root, name: created.name, template: "web", files: Object.keys(STARTER(created.name)) };
    },
    async save(input = {}) {
      const root = normRoot(input.root || input.projectRoot);
      const list = await projectIndex();
      const entry = list.find((p) => p.root === root);
      if (entry && input.name && entry.name !== input.name) { entry.name = String(input.name).slice(0, 80); await saveProjectIndex(list); }
      return { ok: true, manifest: { schemaVersion: 1, name: entry?.name || input.name || root.split("/").pop(), root } };
    },
    async saveChanges() { return { ok: true, saved: true, message: "Los cambios se guardan solos en tu cuenta." }; },
    async cancelCreate() { return false; },
    async templates() { return []; },
    async catalog() {
      const list = await projectIndex();
      return list.map((p) => ({ name: p.name, root: p.root })).sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    },
    async list(rootPath, relativePath = "") { return fsList(rootPath, relativePath); },
    async readText(input = {}) {
      const root = input.projectRoot || input.root;
      const file = await fsRead(root, relFromAny(root, input.path));
      return { ok: true, path: file.path, content: file.content };
    },
    async writeText(input = {}) {
      const root = input.projectRoot || input.root;
      const res = await fsWrite(root, relFromAny(root, input.path), input.content);
      notifyFiles(root, [res.path]);
      return { ok: true, path: res.path };
    },
    async saveEditor(input = {}) { return window.editcoreProject.writeText(input); },
    async createFile(input = {}) { return window.editcoreProject.writeText({ ...input, content: input.content ?? "" }); },
    async mkdir(input = {}) {
      const root = input.projectRoot;
      const data = await readFs(root);
      data.dirs.push(relFromAny(root, input.path));
      await writeFs(root, data);
      notifyFiles(root, []);
      return { ok: true };
    },
    async renameEntry(input = {}) {
      const root = input.projectRoot;
      const from = relFromAny(root, input.from);
      const to = relFromAny(root, input.to);
      if (!from || !to) throw new Error("Ruta inválida.");
      const data = await readFs(root);
      for (const key of Object.keys(data.files)) {
        if (key === from || key.startsWith(`${from}/`)) {
          data.files[to + key.slice(from.length)] = data.files[key];
          delete data.files[key];
        }
      }
      data.dirs = data.dirs.map((d) => (d === from || d.startsWith(`${from}/`) ? to + d.slice(from.length) : d));
      await writeFs(root, data);
      notifyFiles(root, [to]);
      return { ok: true, path: to };
    },
    async deleteEntry(input = {}) {
      const root = input.projectRoot;
      const rel = relFromAny(root, input.path);
      if (!rel) throw new Error("Ruta inválida.");
      await fsDelete(root, rel);
      notifyFiles(root, [rel]);
      return { ok: true };
    },
    async startPreview(rootPath) {
      const root = normRoot(rootPath);
      if (!root) return { available: false, url: "", message: "Abre un proyecto primero." };
      return { available: true, url: previewUrlFor(root), mode: "static" };
    },
    async previewHealth(rootPath) { return { available: Boolean(normRoot(rootPath)), url: previewUrlFor(rootPath) }; },
    async stopPreview() { return { ok: true }; },
    async queryMentions(projectRoot, query) {
      const data = await readFs(projectRoot);
      const q = String(query || "").toLowerCase();
      return Object.keys(data.files).filter((p) => !q || p.toLowerCase().includes(q)).slice(0, 30).map((p) => ({ type: "file", path: p, label: p }));
    },
    async copyPath(input = {}) {
      try { await navigator.clipboard.writeText(String(input.path || "")); } catch { /* ignore */ }
      return { ok: true };
    },
    onFilesChanged: listen(filesListeners),
    onPreviewUpdated: listen(previewListeners),
    onProgress: listen(projectProgressListeners),
  });

  // Atajos que usa el agente web.
  window.EditCoreWebFs = {
    read: fsRead,
    write: fsWrite,
    remove: fsDelete,
    list: fsList,
    all: async (root) => (await readFs(root)).files,
    notify: notifyFiles,
    relFromAny,
  };

  // ── 5. App, ventanas, enlaces, tema y editor ──
  const openUrl = async (url) => {
    if (/^https?:\/\//i.test(String(url || ""))) window.open(url, "_blank", "noopener");
    return { ok: true };
  };
  ns("editcoreApp", {
    openExternal: openUrl,
    async version() { return String(window.EDITCORE_WEB_VERSION || ""); },
    async setUiTheme() { return { ok: true }; },
    async checkUpdates() { return { ok: true, updateAvailable: false }; },
  });
  ns("editcoreShell", { openExternal: openUrl });
  ns("editcoreWindow", {
    async open() { window.open(location.href, "_blank"); return { ok: true }; },
    async status() { return { ok: true, count: 1 }; },
    async reload() { location.reload(); return { ok: true }; },
    async relaunch() { location.reload(); return { ok: true }; },
    async confirmDialog(title, message) { return window.confirm([title, message].filter(Boolean).join("\n\n")); },
  });
  ns("editcoreIdeAssets", {
    monacoVs: () => "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs",
  });
  ns("editcoreModels", {
    async list() {
      try { return await C.listModels(); } catch { return []; }
    },
    async capabilities() { return {}; },
    async recordCapability() { return { ok: true }; },
  });
  ns("editcoreSkills", {
    async list() { return []; },
  });
  ns("editcoreTasks", {
    async list() { return []; },
    async persistPlan() { return { ok: true }; },
    async describeWorkflow() { return null; },
    async status() { return null; },
    async create(input = {}) { return { ok: true, taskId: input.taskId || uuid() }; },
    async cancel() { return { ok: true }; },
    async discard() { return { ok: true }; },
  });
  ns("editcoreMetrics", { async cacheStats() { return { ok: true, hits: 0, misses: 0 }; } });

  // ── 6. Vista previa: el <webview> de Electron se reemplaza por un iframe aislado ──
  function inlinePreviewHtml(files, entry) {
    const read = (rel) => {
      const key = cleanRel(rel.split(/[?#]/)[0]);
      return Object.prototype.hasOwnProperty.call(files, key) ? files[key] : null;
    };
    const dir = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/") + 1) : "";
    const resolve = (href) => {
      if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(href)) return null;
      const parts = (href.startsWith("/") ? href.slice(1) : dir + href).split("/");
      const out = [];
      for (const part of parts) {
        if (part === "..") out.pop();
        else if (part && part !== ".") out.push(part);
      }
      return out.join("/");
    };
    let html = read(entry);
    if (html === null) {
      return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:32px;color:#555">No existe <b>${entry}</b> en este proyecto todavía.</body>`;
    }
    html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      const rel = href && resolve(href);
      const css = rel ? read(rel) : null;
      return css === null ? tag : `<style data-file="${rel}">\n${css}\n</style>`;
    });
    html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, before, src, after) => {
      const rel = resolve(src);
      const js = rel ? read(rel) : null;
      if (js === null) return tag;
      const attrs = `${before} ${after}`.replace(/\s+/g, " ").trim();
      return `<script ${attrs} data-file="${rel}">\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`;
    });
    const bridge = `<script>(function(){var P=function(m){try{parent.postMessage(Object.assign({__ecPreview:1},m),"*")}catch(e){}};
var lv={log:1,info:1,warn:2,error:3};["log","info","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){try{P({type:"console",level:lv[k],message:[].map.call(arguments,function(a){try{return typeof a==="string"?a:JSON.stringify(a)}catch(e){return String(a)}}).join(" ")})}catch(e){}return o.apply(console,arguments)}});
window.addEventListener("error",function(e){P({type:"console",level:3,message:String(e.message||e),line:e.lineno||0,sourceId:e.filename||""})});
window.addEventListener("unhandledrejection",function(e){P({type:"console",level:3,message:"Promesa rechazada: "+String(e.reason&&e.reason.message||e.reason)})});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(!h||h[0]==="#"||/^(?:[a-z]+:|\\/\\/)/i.test(h)||a.target==="_blank")return;e.preventDefault();P({type:"navigate",href:h})},true);
})();</script>`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${bridge}`) : `${bridge}\n${html}`;
  }

  function upgradeWebview(el) {
    if (!el || el.__ecUpgraded) return el;
    el.__ecUpgraded = true;
    const iframe = document.createElement("iframe");
    iframe.className = "web-preview-frame";
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups allow-downloads");
    iframe.setAttribute("title", "Vista previa del proyecto");
    el.appendChild(iframe);
    let currentUrl = "about:blank";
    const history = [];
    let index = -1;
    const fire = (name, extra = {}) => {
      const ev = new Event(name);
      Object.assign(ev, { url: currentUrl, isMainFrame: true }, extra);
      el.dispatchEvent(ev);
    };
    async function render(url, { push = true } = {}) {
      currentUrl = url;
      if (push) {
        history.splice(index + 1);
        history.push(url);
        index = history.length - 1;
      }
      fire("did-start-loading");
      let parsed = null;
      try { parsed = new URL(url, location.href); } catch { parsed = null; }
      if (!parsed || url === "about:blank") {
        iframe.removeAttribute("src");
        iframe.srcdoc = "";
      } else if (parsed.origin === location.origin && parsed.pathname.startsWith(PREVIEW_PREFIX)) {
        const [slug, ...rest] = parsed.pathname.slice(PREVIEW_PREFIX.length).split("/").map(decodeURIComponent);
        const project = await findProjectBySlug(slug);
        const files = project ? (await readFs(project.root)).files : {};
        iframe.removeAttribute("src");
        iframe.srcdoc = project ? inlinePreviewHtml(files, cleanRel(rest.join("/")) || "index.html")
          : `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:32px;color:#555">Proyecto no encontrado.</body>`;
      } else {
        iframe.removeAttribute("srcdoc");
        iframe.src = parsed.href;
      }
    }
    iframe.addEventListener("load", () => {
      fire("dom-ready");
      fire("did-navigate", { httpResponseCode: 200 });
      fire("did-finish-load");
      fire("did-stop-loading");
    });
    window.addEventListener("message", (event) => {
      if (event.source !== iframe.contentWindow || !event.data || event.data.__ecPreview !== 1) return;
      if (event.data.type === "console") {
        fire("console-message", { level: Number(event.data.level || 1), message: String(event.data.message || ""), line: Number(event.data.line || 0), sourceId: String(event.data.sourceId || "") });
      } else if (event.data.type === "navigate") {
        try {
          const next = new URL(String(event.data.href || ""), currentUrl).href;
          el.setAttribute("src", next);
        } catch { /* ignore */ }
      }
    });
    new MutationObserver(() => {
      const src = el.getAttribute("src") || "about:blank";
      if (src !== currentUrl || el.__ecForceReload) {
        el.__ecForceReload = false;
        render(src, { push: !el.__ecHistoryNav });
        el.__ecHistoryNav = false;
      }
    }).observe(el, { attributes: true, attributeFilter: ["src"] });
    Object.assign(el, {
      getURL: () => currentUrl,
      getTitle: () => { try { return iframe.contentDocument?.title || ""; } catch { return ""; } },
      canGoBack: () => index > 0,
      canGoForward: () => index < history.length - 1,
      goBack: () => { if (index > 0) { index -= 1; el.__ecHistoryNav = true; render(history[index], { push: false }); } },
      goForward: () => { if (index < history.length - 1) { index += 1; render(history[index], { push: false }); } },
      reload: () => render(currentUrl, { push: false }),
      reloadIgnoringCache: () => render(currentUrl, { push: false }),
      loadURL: (url) => { el.setAttribute("src", url); return Promise.resolve(); },
      stop: () => {},
      isLoading: () => false,
      executeJavaScript: () => Promise.resolve(null),
      insertCSS: () => Promise.resolve(""),
      setZoomFactor: () => {},
      getZoomFactor: () => 1,
      getWebContentsId: () => 0,
      openDevTools: () => {},
      isDevToolsOpened: () => false,
      send: () => {},
    });
    const initial = el.getAttribute("src");
    if (initial && initial !== "about:blank") render(initial);
    return el;
  }
  const nativeCreate = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, options) {
    const el = nativeCreate.call(this, tag, options);
    if (String(tag).toLowerCase() === "webview") queueMicrotask(() => upgradeWebview(el));
    return el;
  };
  const upgradeAll = (root = document) => root.querySelectorAll?.("webview").forEach(upgradeWebview);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.tagName === "WEBVIEW") upgradeWebview(n);
      else upgradeAll(n);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => upgradeAll());
  // Al cambiar archivos, la vista previa abierta se vuelve a pintar sola.
  previewListeners.add(() => {
    document.querySelectorAll("webview").forEach((el) => {
      const src = el.getAttribute("src") || "";
      if (src.includes(PREVIEW_PREFIX) && typeof el.reload === "function") el.reload();
    });
  });

  window.EditCoreWebBridge = { ready, notifyBalance, publicSession, previewUrlFor, createProject, kv: { get: kvGet, set: kvSet }, slugify };
})();
