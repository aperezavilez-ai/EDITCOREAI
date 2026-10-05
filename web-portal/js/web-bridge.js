// Puente web del chat del IDE: la página /app usa los mismos archivos del IDE (chat-home.js, styles.css,
// chat-home.css, renderer-markdown.js, runtime/credit-ledger.js) y este archivo les da lo que en escritorio
// da Electron (sesión, saldo, administración, envío a la IA), contra el mismo servidor de cuentas.
// Lo que no existe en la web (carpetas, terminal, IDE, dictado, adjuntos, actualizaciones) no se expone.
(function () {
  "use strict";

  const C = window.EditCoreCuentas;
  const $ = (id) => document.getElementById(id);

  const HOME_KEY = "editcore-chat-home-v1";
  const HOME_OWNER_KEY = "editcore-web-home-owner";
  const MESSAGES_PREFIX = "editcore-web-messages:";
  const MODEL_KEY = "editcore-web-model";
  const THEME_KEY = "editcore-ui-theme";
  const THEMES = ["blanco", "gris", "negro", "azul"];
  const HISTORY_TURNS = 24;

  // ── Solo modo chat: la web no tiene la vista IDE ─────────────────────────────
  try {
    localStorage.setItem("editcore-app-mode", "chat");
    const url = new URL(location.href);
    if (url.searchParams.has("mode")) {
      url.searchParams.delete("mode");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch { /* ignore */ }
  window.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.code === "Backquote" || ev.key === "`" || ev.key === "~")) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, { capture: true });

  // ── Tema (mismo almacenamiento que el IDE) ───────────────────────────────────
  function applyTheme(theme) {
    const next = THEMES.includes(theme) ? theme : "blanco";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    return next;
  }
  applyTheme((() => { try { return localStorage.getItem(THEME_KEY); } catch { return ""; } })());
  window.EditCoreTheme = {
    apply: applyTheme,
    get: () => document.documentElement.getAttribute("data-theme") || "blanco",
    list: () => THEMES.slice(),
  };

  // ── Conversaciones por cuenta: en un navegador compartido cada cuenta ve solo las suyas ──
  function swapHomeStoreFor(uid) {
    if (!uid) return false;
    try {
      const owner = localStorage.getItem(HOME_OWNER_KEY) || "";
      if (owner === uid) return false;
      if (owner) localStorage.setItem(`${HOME_KEY}:${owner}`, localStorage.getItem(HOME_KEY) || "");
      const mine = localStorage.getItem(`${HOME_KEY}:${uid}`);
      if (mine) localStorage.setItem(HOME_KEY, mine);
      else localStorage.removeItem(HOME_KEY);
      localStorage.setItem(HOME_OWNER_KEY, uid);
      return Boolean(owner) || Boolean(mine);
    } catch {
      return false;
    }
  }
  if (C?.hasSession?.()) swapHomeStoreFor(C.sessionUser().id);

  const currentUid = () => (C?.hasSession?.() ? C.sessionUser().id || "" : "");
  const messagesKey = () => MESSAGES_PREFIX + (currentUid() || "anon");

  function loadAllMessages() {
    try {
      const raw = JSON.parse(localStorage.getItem(messagesKey()) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }
  function saveAllMessages(all) {
    try {
      localStorage.setItem(messagesKey(), JSON.stringify(all));
    } catch {
      // Sin espacio: se recortan las conversaciones más largas a sus últimos mensajes.
      for (const id of Object.keys(all)) all[id] = (all[id] || []).slice(-40);
      try { localStorage.setItem(messagesKey(), JSON.stringify(all)); } catch { /* ignore */ }
    }
  }
  const loadMessages = (threadId) => (loadAllMessages()[threadId] || []).slice();
  function saveMessages(threadId, list) {
    if (!threadId) return;
    const all = loadAllMessages();
    all[threadId] = list.slice(-200);
    saveAllMessages(all);
  }
  function activeThreadId() {
    try {
      return String(JSON.parse(localStorage.getItem(HOME_KEY) || "{}").activeId || "");
    } catch {
      return "";
    }
  }

  // ── Sesión (misma forma que publicSession del IDE) ───────────────────────────
  let account = null;
  let loginError = "";
  const sessionListeners = new Set();
  const blockedListeners = new Set();
  const balanceListeners = new Set();
  const emit = (set, payload) => set.forEach((fn) => { try { fn(payload); } catch { /* ignore */ } });

  const ready = (async () => {
    if (!C) return;
    try {
      const session = await C.completeLoginFromUrl();
      if (session && swapHomeStoreFor(session.user?.id || "")) {
        location.replace(location.pathname);
        await new Promise(() => {});
      }
    } catch (error) {
      loginError = error?.message || "No se pudo completar el inicio de sesión con Google.";
    }
  })();

  function publicSession() {
    if (!C?.isConfigured?.()) return { isAuthenticated: false, user: null, configured: false };
    if (!C.hasSession()) return { isAuthenticated: false, user: null, configured: true };
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

  // Lo que runtime/credit-ledger.js espera de auth-manager.
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

  window.editcoreAuth = {
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
      abortCurrent();
      await C.logout();
      account = null;
      return { ok: true };
    },
    onSessionChanged(cb) {
      if (typeof cb !== "function") return () => {};
      sessionListeners.add(cb);
      return () => sessionListeners.delete(cb);
    },
    onBlocked(cb) {
      if (typeof cb !== "function") return () => {};
      blockedListeners.add(cb);
      return () => blockedListeners.delete(cb);
    },
  };

  // ── Saldo y administración: el mismo CreditLedger del IDE ────────────────────
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
    ledgerInstance.on("balance-changed", (view) => emit(balanceListeners, view));
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
  function openPayment(url) {
    const win = window.open(url, "_blank", "noopener");
    if (!win) location.assign(url);
  }

  async function notifyBalance() {
    try {
      const view = await ledger().getBalance();
      if (view?.ok !== false) emit(balanceListeners, view);
    } catch { /* ignore */ }
  }

  window.editcoreCredits = {
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
    cloudModels: safe(async () => ({ ok: true, models: await C.listModels() })),
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
    onBalanceChanged(cb) {
      if (typeof cb !== "function") return () => {};
      balanceListeners.add(cb);
      return () => balanceListeners.delete(cb);
    },
  };

  window.editcoreApp = {
    openExternal: async (url) => {
      if (/^https:\/\//i.test(String(url || ""))) window.open(url, "_blank", "noopener");
      return { ok: true };
    },
  };

  // ── Modelos: mismo menú que el IDE, con los modelos que el servidor permite ──
  let modelsCache = [];
  let modelsLoading = null;
  const getSelectedModel = () => { try { return localStorage.getItem(MODEL_KEY) || ""; } catch { return ""; } };

  function loadModels(force = false) {
    if (modelsLoading && !force) return modelsLoading;
    modelsLoading = (async () => {
      try {
        modelsCache = await C.listModels();
      } catch {
        if (!modelsCache.length) modelsLoading = null;
      }
      syncModelLabel();
      return modelsCache;
    })();
    return modelsLoading;
  }

  function autoModel(list) {
    return list.find((m) => /claude-sonnet-4[.-]6/i.test(m))
      || list.find((m) => /claude-sonnet/i.test(m))
      || list[0]
      || "";
  }

  async function resolveModel() {
    const list = modelsCache.length ? modelsCache : await loadModels();
    const chosen = getSelectedModel();
    if (chosen && list.includes(chosen)) return chosen;
    return autoModel(list);
  }

  function syncModelLabel() {
    const label = $("modelPickerLabel");
    if (!label) return;
    const chosen = getSelectedModel();
    const text = chosen && (!modelsCache.length || modelsCache.includes(chosen)) ? chosen : "Auto";
    if (label.textContent !== text) label.textContent = text;
    window.dispatchEvent(new Event("editcore:models-updated"));
  }

  function selectModel(model) {
    try {
      if (model) localStorage.setItem(MODEL_KEY, model);
      else localStorage.removeItem(MODEL_KEY);
    } catch { /* ignore */ }
    syncModelLabel();
  }

  function positionMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth || 320;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const height = menu.offsetHeight || 280;
    let top = rect.top - height - 8;
    if (top < 12) top = rect.bottom + 8;
    Object.assign(menu.style, { position: "fixed", left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto", zIndex: "10050" });
  }

  function renderModelMenu(menu) {
    menu.replaceChildren();
    let search = "";
    const searchWrap = document.createElement("div");
    searchWrap.className = "model-picker-search-wrap";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "model-picker-search";
    input.placeholder = "Buscar modelos";
    input.autocomplete = "off";
    input.spellcheck = false;
    searchWrap.appendChild(input);
    menu.appendChild(searchWrap);

    const autoOn = !getSelectedModel() || (modelsCache.length && !modelsCache.includes(getSelectedModel()));
    const autoRow = document.createElement("div");
    autoRow.className = "model-picker-auto-row";
    const autoCopy = document.createElement("div");
    autoCopy.className = "model-picker-auto-copy";
    const strong = document.createElement("strong");
    strong.textContent = "Auto";
    const hint = document.createElement("span");
    hint.textContent = "EditCoreAI elige el mejor modelo para cada tarea.";
    autoCopy.append(strong, hint);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "model-toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", autoOn ? "true" : "false");
    toggle.setAttribute("aria-label", "Activar Auto");
    toggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectModel(autoOn ? autoModel(modelsCache) : "");
      renderModelMenu(menu);
    });
    autoRow.append(autoCopy, toggle);
    menu.appendChild(autoRow);

    const paint = () => {
      menu.querySelector(".model-picker-scroll")?.remove();
      const scroll = document.createElement("div");
      scroll.className = "model-picker-scroll";
      const q = search.trim().toLowerCase();
      const list = modelsCache.filter((m) => !q || m.toLowerCase().includes(q));
      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "model-picker-empty";
        empty.textContent = modelsCache.length ? "Ningún modelo coincide con la búsqueda" : "Cargando modelos…";
        scroll.appendChild(empty);
      } else {
        const heading = document.createElement("div");
        heading.className = "model-picker-group";
        heading.textContent = "EditCoreAI";
        scroll.appendChild(heading);
        const chosen = getSelectedModel();
        for (const model of list) {
          const active = !autoOn && chosen === model;
          const row = document.createElement("div");
          row.className = `model-picker-row${active ? " active" : ""}`;
          const pick = document.createElement("button");
          pick.type = "button";
          pick.className = "model-picker-item";
          pick.setAttribute("role", "option");
          pick.setAttribute("aria-selected", active ? "true" : "false");
          pick.title = "Usar este modelo";
          const check = document.createElement("span");
          check.className = "model-picker-check";
          check.setAttribute("aria-hidden", "true");
          check.textContent = "✓";
          const name = document.createElement("span");
          name.className = "model-picker-name";
          name.textContent = model;
          pick.append(check, name);
          pick.addEventListener("click", () => {
            selectModel(model);
            closeModelPicker();
          });
          row.appendChild(pick);
          scroll.appendChild(row);
        }
      }
      menu.appendChild(scroll);
    };
    input.addEventListener("input", () => { search = input.value; paint(); });
    input.addEventListener("click", (ev) => ev.stopPropagation());
    paint();
  }

  let pickerAnchor = null;
  function openModelPicker(anchor) {
    const menu = $("modelPickerMenu");
    if (!menu) return;
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    pickerAnchor = anchor || $("chatHomeModelPill");
    renderModelMenu(menu);
    menu.classList.remove("hidden");
    if (pickerAnchor) positionMenu(menu, pickerAnchor);
    menu.querySelector(".model-picker-search")?.focus();
    if (!modelsCache.length) {
      void loadModels(true).then(() => {
        if (!menu.classList.contains("hidden")) {
          renderModelMenu(menu);
          if (pickerAnchor) positionMenu(menu, pickerAnchor);
        }
      });
    }
  }
  function closeModelPicker() {
    $("modelPickerMenu")?.classList.add("hidden");
  }
  document.addEventListener("click", (ev) => {
    const menu = $("modelPickerMenu");
    if (!menu || menu.classList.contains("hidden")) return;
    if (menu.contains(ev.target) || ev.target === pickerAnchor) return;
    closeModelPicker();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeModelPicker();
  });

  window.EditCoreModels = {
    openPicker: openModelPicker,
    closePicker: closeModelPicker,
    isOpen: () => !$("modelPickerMenu")?.classList.contains("hidden"),
    refreshForRole: async () => { await loadModels(true); },
  };

  // ── Mensajes con el mismo DOM que el IDE (renderer.js append/appendThinking/appendStreaming) ──
  function renderMarkdown(text, { fromUser = false } = {}) {
    if (!fromUser && typeof window.scrubAiProviderNames === "function") text = window.scrubAiProviderNames(text);
    if (typeof window.renderMarkdownSecure === "function") return window.renderMarkdownSecure(String(text || ""));
    const div = document.createElement("div");
    div.textContent = String(text || "");
    return `<p>${div.innerHTML.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  }
  function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
  }

  let stickToBottom = true;
  function scrollRoot() { return $("chatHomeFeedHost"); }
  function scrollToBottom(force = false) {
    const host = scrollRoot();
    if (!host) return;
    if (force) stickToBottom = true;
    if (!stickToBottom) return;
    host.scrollTop = host.scrollHeight;
  }
  window.EditCoreChatScroll = { toBottom: (force) => scrollToBottom(force === true) };
  document.addEventListener("DOMContentLoaded", () => {
    scrollRoot()?.addEventListener("scroll", () => {
      const host = scrollRoot();
      stickToBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
    }, { passive: true });
  });

  function append(role, text, elapsedSeconds = null) {
    const item = document.createElement("article");
    item.className = `msg ${role}`;
    const head = document.createElement("div");
    head.className = "msg-head";
    head.textContent = role === "user" ? "Tú" : `EditCoreAI${elapsedSeconds === null ? "" : ` ${formatElapsed(elapsedSeconds)}`}`;
    const body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = renderMarkdown(text, { fromUser: role === "user" });
    item.append(head, body);
    $("feed")?.appendChild(item);
    scrollToBottom(role === "user");
    return item;
  }

  function appendThinking(statusText = "Pensando / razonando...") {
    const item = document.createElement("article");
    item.className = "msg assistant thinking-msg agent-execution-card";
    const head = document.createElement("div");
    head.className = "msg-head";
    head.textContent = "EditCoreAI";
    const body = document.createElement("div");
    body.className = "msg-body msg-thinking";
    const primary = document.createElement("div");
    primary.className = "thinking-primary";
    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML = "<span></span><span></span><span></span>";
    const status = document.createElement("span");
    status.className = "thinking-status";
    status.textContent = statusText;
    primary.append(dots, status);
    body.appendChild(primary);
    item.append(head, body);
    $("feed")?.appendChild(item);
    scrollToBottom(true);
    return { item, status };
  }

  function appendStreaming() {
    const item = document.createElement("article");
    item.className = "msg assistant";
    item.id = "streamingMsg";
    const head = document.createElement("div");
    head.className = "msg-head";
    head.textContent = "EditCoreAI";
    const body = document.createElement("div");
    body.className = "msg-body";
    item.append(head, body);
    $("feed")?.appendChild(item);
    scrollToBottom();
    return { item, body };
  }

  function renderThread(threadId) {
    const feed = $("feed");
    if (!feed) return;
    feed.replaceChildren();
    for (const m of loadMessages(threadId)) {
      if (m.role === "user" || m.role === "assistant") append(m.role, m.content, m.role === "assistant" && m.elapsed != null ? m.elapsed : null);
    }
    if (current && current.threadId === threadId) {
      const t = appendThinking(current.reasoning ? "Razonando…" : "Pensando / razonando...");
      current.thinking = t;
      current.streamEl = null;
    }
    scrollToBottom(true);
  }

  window.switchChatThread = async (id) => { renderThread(id); };
  window.closeChatThread = (id) => {
    if (current?.threadId === id) abortCurrent();
    const all = loadAllMessages();
    delete all[id];
    saveAllMessages(all);
  };
  window.renameChatThread = () => {};

  // ── Envío a la IA ────────────────────────────────────────────────────────────
  const ERROR_TEXT = {
    OUT_OF_CREDITS: "Tu saldo se agotó. Recarga para seguir usando la IA de EditCoreAI.",
    ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contacta al administrador.",
    NO_SESSION: "Inicia sesión con Google para usar EditCoreAI.",
    SESSION_EXPIRED: "Tu sesión expiró. Vuelve a iniciar sesión con Google.",
  };
  const queue = [];
  let current = null;

  function setSendBusy(busy) {
    const btn = $("chatHomeSendBtn");
    if (!btn) return;
    btn.classList.toggle("is-busy", busy);
    btn.textContent = busy ? "■" : "↑";
    btn.title = busy ? "Detener" : "Enviar";
    btn.setAttribute("aria-label", busy ? "Detener" : "Enviar");
  }
  function abortCurrent() {
    queue.length = 0;
    try { current?.controller?.abort(); } catch { /* ignore */ }
  }

  function buildMessages(history) {
    const persona = String(window.EDITCORE_WEB_PERSONA || "Eres EditCoreAI. Responde siempre en español, claro y directo.");
    const turns = history
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.error && String(m.content || "").trim())
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: String(m.content) }));
    return [{ role: "system", content: persona }, ...turns];
  }

  async function runTurn(prompt) {
    const threadId = activeThreadId();
    const history = loadMessages(threadId);
    history.push({ role: "user", content: prompt, at: Date.now() });
    saveMessages(threadId, history);
    append("user", prompt);

    const startedAt = Date.now();
    const turn = { threadId, controller: new AbortController(), reasoning: false, thinking: appendThinking(), streamEl: null, body: null, text: "" };
    current = turn;
    setSendBusy(true);
    const ticker = setInterval(() => {
      if (turn.reasoning && turn.thinking?.status) {
        turn.thinking.status.textContent = `Razonando… ${formatElapsed((Date.now() - startedAt) / 1000)}`;
      }
    }, 1000);
    let painting = false;
    const paint = () => {
      if (painting) return;
      painting = true;
      requestAnimationFrame(() => {
        painting = false;
        if (turn.body) turn.body.innerHTML = renderMarkdown(turn.text);
        scrollToBottom();
      });
    };

    try {
      const model = await resolveModel();
      if (!model) throw Object.assign(new Error("No hay modelos disponibles por ahora. Intenta de nuevo en un momento."), { code: "NO_MODELS" });
      const finalText = await C.chat({
        model,
        messages: buildMessages(history),
        signal: turn.controller.signal,
        onThinking: () => {
          if (!turn.reasoning) {
            turn.reasoning = true;
            if (turn.thinking?.status) turn.thinking.status.textContent = "Razonando…";
          }
        },
        onDelta: (_chunk, full) => {
          turn.text = full;
          if (!turn.streamEl && activeThreadId() === threadId) {
            turn.thinking?.item?.remove();
            turn.thinking = null;
            const s = appendStreaming();
            turn.streamEl = s.item;
            turn.body = s.body;
          }
          paint();
        },
      });
      turn.text = finalText;
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const saved = loadMessages(threadId);
      saved.push({ role: "assistant", content: finalText, model, at: Date.now() });
      saveMessages(threadId, saved);
      turn.thinking?.item?.remove();
      if (turn.streamEl) {
        turn.streamEl.id = "";
        if (turn.body) turn.body.innerHTML = renderMarkdown(finalText);
      } else if (activeThreadId() === threadId) {
        append("assistant", finalText, elapsed);
      }
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      const code = String(error?.code || "");
      if (code === "OUT_OF_CREDITS" || code === "ACCOUNT_SUSPENDED" || code === "NO_SESSION" || code === "SESSION_EXPIRED") {
        emit(blockedListeners, { code });
      }
      const message = cancelled
        ? "Cancelado por el usuario."
        : (ERROR_TEXT[code] || error?.message || "EditCoreAI no recibió una respuesta legible. Intenta de nuevo.");
      turn.thinking?.item?.remove();
      turn.streamEl?.remove();
      const saved = loadMessages(threadId);
      saved.push({ role: "assistant", content: message, error: true, at: Date.now() });
      saveMessages(threadId, saved);
      if (activeThreadId() === threadId) append("assistant", message, Math.floor((Date.now() - startedAt) / 1000));
    } finally {
      clearInterval(ticker);
      if (current === turn) current = null;
      setSendBusy(false);
      if (activeThreadId() === threadId && turn.streamEl && !turn.streamEl.isConnected) renderThread(threadId);
      scrollToBottom();
      void notifyBalance();
    }
  }

  async function drain() {
    while (queue.length) {
      const prompt = queue.shift();
      await runTurn(prompt);
    }
  }

  window.sendChatPrompt = (text) => {
    const prompt = String(text || "").trim();
    if (!prompt) return;
    queue.push(prompt);
    if (!current) void drain();
  };

  // ── Arranque: cosas de la web que el IDE no necesita ─────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const prompt = $("chatHomePrompt");
    if (prompt) {
      prompt.placeholder = "Pregunta a EditCoreAI: código, errores, ideas…";
      // Sin "/" ni "@" del IDE (actúan sobre carpetas, git y archivos locales).
      prompt.addEventListener("input", (ev) => ev.stopImmediatePropagation());
    }
    $("chatHomeSendBtn")?.addEventListener("click", (ev) => {
      if (current && !String($("chatHomePrompt")?.value || "").trim()) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        abortCurrent();
      }
    });
    if (loginError) {
      const status = $("authLoginStatus");
      if (status) {
        status.hidden = false;
        status.removeAttribute("hidden");
        status.className = "ec-status-msg ec-tag-danger";
        status.textContent = loginError;
      }
    }
    syncModelLabel();
    void ready.then(() => {
      if (C?.hasSession?.()) void loadModels();
      setTimeout(() => renderThread(activeThreadId()), 0);
    });
  });
})();
