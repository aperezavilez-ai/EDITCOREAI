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
      let mainStore = JSON.parse(localStorage.getItem(messagesKey()) || "{}");
      if (!mainStore || typeof mainStore !== "object") mainStore = {};
      const anonStore = JSON.parse(localStorage.getItem(MESSAGES_PREFIX + "anon") || "{}");
      if (anonStore && typeof anonStore === "object") {
        for (const [k, v] of Object.entries(anonStore)) {
          if (!mainStore[k] || !mainStore[k].length) mainStore[k] = v;
        }
      }
      return mainStore;
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
      if (typeof window.getActiveChatThreadId === "function") {
        const id = window.getActiveChatThreadId();
        if (id) return String(id);
      }
      const activeEl = document.querySelector(".chat-home-thread-item.active, [data-thread-id].active, .chat-home-item.active");
      if (activeEl?.dataset?.threadId) return String(activeEl.dataset.threadId);
    } catch { /* ignore */ }
    try {
      const raw = JSON.parse(localStorage.getItem(HOME_KEY) || "{}");
      if (raw.activeId) return String(raw.activeId);
      if (Array.isArray(raw.threads) && raw.threads.length > 0 && raw.threads[0]?.id) {
        return String(raw.threads[0].id);
      }
    } catch { /* ignore */ }
    try {
      const all = loadAllMessages();
      const keys = Object.keys(all).filter(Boolean);
      if (keys.length > 0) return keys[keys.length - 1];
    } catch { /* ignore */ }
    return "default";
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

  // ── Adjuntos y Capturas de Pantalla ─────────────────────────────────────────
  const attachedFiles = [];

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderAttachmentChips() {
    const list = $("chatHomeAttachmentList");
    if (!list) return;
    list.replaceChildren();
    if (!attachedFiles.length) {
      list.style.display = "none";
      return;
    }
    list.style.display = "flex";
    attachedFiles.forEach((item, idx) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      chip.style.cssText = "display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;background:var(--ch-surface,#f1f5f9);border:1px solid var(--ch-border,#cbd5e1);font-size:12px;max-width:240px;position:relative;";
      
      if (item.dataUrl && item.type.startsWith("image/")) {
        const thumb = document.createElement("img");
        thumb.src = item.dataUrl;
        thumb.alt = item.name;
        thumb.style.cssText = "width:22px;height:22px;object-fit:cover;border-radius:4px;border:1px solid #cbd5e1;";
        chip.appendChild(thumb);
      } else {
        const icon = document.createElement("span");
        icon.textContent = "📄";
        chip.appendChild(icon);
      }

      const name = document.createElement("span");
      name.textContent = item.name;
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;font-size:11px;max-width:140px;";
      name.title = `${item.name} (${formatBytes(item.size)})`;
      chip.appendChild(name);

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.title = "Eliminar archivo adjunto";
      del.style.cssText = "border:none;background:transparent;cursor:pointer;color:#64748b;font-weight:bold;font-size:14px;padding:0 2px;line-height:1;";
      del.onmouseenter = () => { del.style.color = "#ef4444"; };
      del.onmouseleave = () => { del.style.color = "#64748b"; };
      del.onclick = (e) => {
        e.stopPropagation();
        attachedFiles.splice(idx, 1);
        renderAttachmentChips();
      };
      chip.appendChild(del);
      list.appendChild(chip);
    });
  }

  async function addAttachmentFiles(files) {
    if (!files || !files.length) return;
    for (const file of Array.from(files)) {
      const isImg = file.type.startsWith("image/");
      const reader = new FileReader();
      await new Promise((resolve) => {
        if (isImg) {
          reader.onload = () => {
            attachedFiles.push({
              name: file.name || "captura.png",
              size: file.size,
              type: file.type || "image/png",
              dataUrl: reader.result,
            });
            resolve();
          };
          reader.readAsDataURL(file);
        } else {
          reader.onload = () => {
            attachedFiles.push({
              name: file.name,
              size: file.size,
              type: file.type || "text/plain",
              text: typeof reader.result === "string" ? reader.result : "",
            });
            resolve();
          };
          reader.readAsText(file);
        }
      });
    }
    renderAttachmentChips();
  }

  window.EditCoreAttachments = {
    openPicker: () => $("fileInput")?.click(),
    addFiles: (files) => addAttachmentFiles(files),
    clear: () => { attachedFiles.length = 0; renderAttachmentChips(); },
    list: () => attachedFiles.slice(),
  };

  function append(role, text, elapsedSeconds = null, attachments = []) {
    const item = document.createElement("article");
    item.className = `msg ${role}`;
    const head = document.createElement("div");
    head.className = "msg-head";
    head.textContent = role === "user" ? "Tú" : `EditCoreAI${elapsedSeconds === null ? "" : ` ${formatElapsed(elapsedSeconds)}`}`;
    const body = document.createElement("div");
    body.className = "msg-body";

    if (Array.isArray(attachments) && attachments.length > 0) {
      const attWrap = document.createElement("div");
      attWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;";
      for (const att of attachments) {
        if (att.dataUrl && att.type.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = att.dataUrl;
          img.alt = att.name || "captura";
          img.style.cssText = "max-width:180px;max-height:140px;border-radius:6px;border:1px solid #cbd5e1;object-fit:cover;cursor:pointer;";
          img.onclick = () => window.open(att.dataUrl, "_blank");
          attWrap.appendChild(img);
        } else if (att.name) {
          const fileChip = document.createElement("span");
          fileChip.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;background:rgba(0,0,0,0.06);font-size:11px;font-family:monospace;";
          fileChip.textContent = "📄 " + att.name;
          attWrap.appendChild(fileChip);
        }
      }
      body.appendChild(attWrap);
    }

    if (Array.isArray(text)) text = text.find(t => t.type === "text")?.text || "";
    const textDiv = document.createElement("div");
    textDiv.innerHTML = renderMarkdown(text, { fromUser: role === "user" });
    body.appendChild(textDiv);

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
      if (m.role === "user" || m.role === "assistant") {
        append(m.role, m.content, m.role === "assistant" && m.elapsed != null ? m.elapsed : null, m.attachments || []);
      }
    }
    if (current && current.threadId === threadId) {
      const t = appendThinking(current.reasoning ? "Razonando…" : "Pensando / razonando...");
      current.thinking = t;
      current.streamEl = null;
    }
    scrollToBottom(true);
  }

  window.switchChatThread = async (id) => {
    renderThread(id);
    syncWebProjectFolder(id);
    refreshProjectFilesUI(id);
    renderWebPreview(id);
  };
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
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.error && (Array.isArray(m.content) || String(m.content || "").trim()))
      .slice(-HISTORY_TURNS)
      .map((m) => {
        if (m.role === "user" && Array.isArray(m.attachments) && m.attachments.length > 0) {
          const parts = [{ type: "text", text: String(m.content || "") }];
          for (const att of m.attachments) {
            if (att.dataUrl && att.type.startsWith("image/")) {
              parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
            } else if (att.text) {
              parts[0].text += `\n\n[Adjunto: ${att.name}]\n${att.text}\n[Fin adjunto]`;
            }
          }
          return { role: m.role, content: parts.length > 1 ? parts : parts[0].text };
        }
        return { role: m.role, content: m.content };
      });
    return [{ role: "system", content: persona }, ...turns];
  }

  async function runTurn(prompt) {
    const threadId = activeThreadId();
    const history = loadMessages(threadId);
    const turnAttachments = attachedFiles.slice();
    attachedFiles.length = 0;
    renderAttachmentChips();

    history.push({ role: "user", content: prompt, attachments: turnAttachments, at: Date.now() });
    saveMessages(threadId, history);
    append("user", prompt, null, turnAttachments);

    if (!getWebProjectName(threadId)) {
      const inferred = inferProjectName(prompt);
      if (inferred) setWebProjectName(threadId, inferred);
    }
    syncWebProjectFolder(threadId);

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
          if (full.includes("```") || full.includes("filepath:") || full.includes("<!DOCTYPE") || full.includes("<html")) {
            updateProjectFromTurn(threadId, full);
          }
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
      try {
        updateProjectFromTurn(threadId, finalText);
        syncWebProjectFolder(threadId);
        const p = $("chatHomeContextPanel");
        if (p && p.hidden) {
          p.hidden = false;
          p.setAttribute("aria-hidden", "false");
          $("chatHomeContextDock")?.classList.add("is-active");
        }
      } catch (err) {
        console.warn("[EditCore Web] Error al actualizar archivos de proyecto:", err);
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

  // ─── SUITE WEB: ARCHIVOS VIRTUALES, PREVIEW EN VIVO Y DESCARGA ZIP ─────────
  const PROJECT_FILES_PREFIX = "editcore-web-project-files:";

  function getProjectFilesKey(threadId) {
    const tid = threadId || activeThreadId() || "default";
    return PROJECT_FILES_PREFIX + tid;
  }

  function generateDefaultStoreProject() {
    return {
      "index.html": `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tienda Multi-Ventas · EditCoreAI</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="navbar">
    <div class="nav-container">
      <div class="brand">
        <span class="brand-icon">🛒</span>
        <span class="brand-name">TiendaVentas</span>
      </div>
      <div class="search-bar">
        <input type="text" id="searchInput" placeholder="Buscar productos por nombre...">
        <button type="button" id="searchBtn">🔍</button>
      </div>
      <div class="nav-actions">
        <button type="button" id="cartToggleBtn" class="cart-btn" title="Ver carrito de compras">
          🛍️ Carrito <span id="cartCountBadge" class="badge">0</span>
        </button>
      </div>
    </div>
  </header>

  <section class="hero-banner">
    <div class="hero-content">
      <h2>Catálogo de Ventas de Todo Tipo</h2>
      <p>Explora nuestras mejores categorías: Tecnología, Moda, Calzado y Accesorios.</p>
    </div>
  </section>

  <div class="container filters-section">
    <div class="category-pills" id="categoryPills">
      <button type="button" class="pill active" data-category="all">Todos</button>
      <button type="button" class="pill" data-category="tecnologia">Tecnología</button>
      <button type="button" class="pill" data-category="moda">Moda</button>
      <button type="button" class="pill" data-category="calzado">Calzado</button>
      <button type="button" class="pill" data-category="hogar">Hogar</button>
    </div>
  </div>

  <main class="container">
    <div class="products-grid" id="productsGrid"></div>
  </main>

  <div id="cartDrawer" class="cart-drawer hidden">
    <div class="cart-drawer-overlay" id="cartOverlay"></div>
    <div class="cart-drawer-panel">
      <div class="cart-header">
        <h3>Tu Carrito de Compras</h3>
        <button type="button" id="cartCloseBtn" class="close-btn">&times;</button>
      </div>
      <div class="cart-items" id="cartItemsList">
        <p class="empty-cart-msg">Tu carrito está vacío.</p>
      </div>
      <div class="cart-footer">
        <div class="cart-total-row">
          <span>Total:</span>
          <strong id="cartTotalPrice">$0.00</strong>
        </div>
        <button type="button" id="checkoutBtn" class="btn-checkout">Completar Pedido 💳</button>
      </div>
    </div>
  </div>

  <div id="checkoutModal" class="modal hidden">
    <div class="modal-card">
      <div class="modal-icon">✅</div>
      <h3>¡Pedido Confirmado!</h3>
      <p id="checkoutSummaryText">Tu compra ha sido procesada con éxito.</p>
      <button type="button" id="modalCloseBtn" class="btn-primary">Continuar Comprando</button>
    </div>
  </div>

  <footer class="footer">
    <p>&copy; 2026 TiendaVentas MVP — Diseñado con EditCoreAI</p>
  </footer>

  <script src="app.js"></script>
</body>
</html>`,

      "styles.css": `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: #f8fafc;
  color: #1e293b;
  line-height: 1.5;
  padding-bottom: 60px;
}
.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 16px;
}
.navbar {
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.nav-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 1.25rem;
  color: #0f172a;
}
.search-bar {
  display: flex;
  flex: 1;
  max-width: 450px;
  background: #f1f5f9;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  overflow: hidden;
}
.search-bar input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px 12px;
  font-size: 0.9rem;
  outline: none;
}
.search-bar button {
  border: none;
  background: #e2e8f0;
  padding: 0 14px;
  cursor: pointer;
}
.cart-btn {
  background: #0f172a;
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.2s;
}
.cart-btn:hover { opacity: 0.9; }
.badge {
  background: #ef4444;
  color: #ffffff;
  font-size: 0.75rem;
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 700;
}
.hero-banner {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  color: #ffffff;
  padding: 36px 16px;
  text-align: center;
  margin-bottom: 24px;
}
.hero-banner h2 { font-size: 1.75rem; margin-bottom: 8px; }
.hero-banner p { color: #cbd5e1; font-size: 1rem; }
.filters-section { margin-bottom: 24px; }
.category-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pill {
  padding: 6px 16px;
  border-radius: 9999px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.pill.active, .pill:hover {
  background: #0f172a;
  color: #ffffff;
  border-color: #0f172a;
}
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}
.product-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.2s, box-shadow 0.2s;
}
.product-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 20px rgba(0,0,0,0.06);
}
.product-img {
  height: 180px;
  background: #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3.5rem;
}
.product-info {
  padding: 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.product-cat {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #64748b;
  font-weight: 700;
  margin-bottom: 4px;
}
.product-title {
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
}
.product-price {
  font-size: 1.15rem;
  font-weight: 800;
  color: #059669;
  margin-top: auto;
  margin-bottom: 12px;
}
.btn-add {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 8px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-add:hover { background: #1d4ed8; }
.cart-drawer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}
.cart-drawer.hidden { display: none; }
.cart-drawer-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.4);
}
.cart-drawer-panel {
  position: relative;
  width: 100%;
  max-width: 380px;
  height: 100%;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0,0,0,0.15);
}
.cart-header {
  padding: 16px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #64748b;
}
.cart-items {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cart-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.cart-item-title { font-weight: 600; font-size: 0.9rem; }
.cart-item-price { font-size: 0.85rem; color: #64748b; }
.cart-item-qty { display: flex; align-items: center; gap: 6px; }
.qty-btn {
  width: 24px;
  height: 24px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 4px;
  cursor: pointer;
}
.cart-footer {
  padding: 16px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}
.cart-total-row {
  display: flex;
  justify-content: space-between;
  font-size: 1.1rem;
  margin-bottom: 12px;
}
.btn-checkout {
  width: 100%;
  background: #059669;
  color: #ffffff;
  border: none;
  padding: 12px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
}
.btn-checkout:hover { background: #047857; }
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
}
.modal.hidden { display: none; }
.modal-card {
  background: #ffffff;
  padding: 24px;
  border-radius: 12px;
  text-align: center;
  max-width: 360px;
  width: 100%;
}
.modal-icon { font-size: 3rem; margin-bottom: 8px; }
.btn-primary {
  margin-top: 16px;
  background: #0f172a;
  color: #ffffff;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
.footer {
  text-align: center;
  margin-top: 40px;
  color: #64748b;
  font-size: 0.85rem;
}`,

      "app.js": `const PRODUCTS = [
  { id: 1, name: "Auriculares Inalámbricos Pro", category: "tecnologia", price: 59.99, icon: "🎧" },
  { id: 2, name: "Smartwatch Deportivo V2", category: "tecnologia", price: 89.99, icon: "⌚" },
  { id: 3, name: "Camiseta Algodón Premium", category: "moda", price: 24.50, icon: "👕" },
  { id: 4, name: "Zapatillas Urban Runner", category: "calzado", price: 75.00, icon: "👟" },
  { id: 5, name: "Lámpara de Escritorio LED", category: "hogar", price: 32.00, icon: "💡" },
  { id: 6, name: "Mochila Ergonómica Impermeable", category: "moda", price: 45.00, icon: "🎒" }
];

let cart = [];
let activeCategory = "all";
let searchQuery = "";

function init() {
  renderProducts();
  setupEvents();
  updateCartBadge();
}

function renderProducts() {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;
  const filtered = PRODUCTS.filter(p => {
    const matchCat = activeCategory === "all" || p.category === activeCategory;
    const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  if (!filtered.length) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#64748b; padding:40px;">No se encontraron productos con ese filtro.</p>';
    return;
  }

  grid.innerHTML = filtered.map(p => \`
    <div class="product-card">
      <div class="product-img">\${p.icon}</div>
      <div class="product-info">
        <span class="product-cat">\${p.category}</span>
        <h4 class="product-title">\${p.name}</h4>
        <span class="product-price">$\${p.price.toFixed(2)}</span>
        <button type="button" class="btn-add" onclick="addToCart(\${p.id})">Añadir al Carrito</button>
      </div>
    </div>
  \`).join("");
}

window.addToCart = function(productId) {
  const item = PRODUCTS.find(p => p.id === productId);
  if (!item) return;
  const existing = cart.find(c => c.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  updateCartBadge();
  renderCartDrawer();
  openCart();
};

window.changeQty = function(productId, delta) {
  const item = cart.find(c => c.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(c => c.id !== productId);
  }
  updateCartBadge();
  renderCartDrawer();
};

function updateCartBadge() {
  const count = cart.reduce((acc, item) => acc + item.qty, 0);
  const badge = document.getElementById("cartCountBadge");
  if (badge) badge.textContent = String(count);
}

function renderCartDrawer() {
  const list = document.getElementById("cartItemsList");
  const totalEl = document.getElementById("cartTotalPrice");
  if (!list || !totalEl) return;

  if (!cart.length) {
    list.innerHTML = '<p class="empty-cart-msg">Tu carrito está vacío.</p>';
    totalEl.textContent = "$0.00";
    return;
  }

  let total = 0;
  list.innerHTML = cart.map(item => {
    const itemTotal = item.price * item.qty;
    total += itemTotal;
    return \`
      <div class="cart-item">
        <div>
          <div class="cart-item-title">\${item.icon} \${item.name}</div>
          <div class="cart-item-price">$\${item.price.toFixed(2)} c/u</div>
        </div>
        <div class="cart-item-qty">
          <button type="button" class="qty-btn" onclick="changeQty(\${item.id}, -1)">-</button>
          <span>\${item.qty}</span>
          <button type="button" class="qty-btn" onclick="changeQty(\${item.id}, 1)">+</button>
        </div>
      </div>
    \`;
  }).join("");

  totalEl.textContent = "$" + total.toFixed(2);
}

function openCart() {
  document.getElementById("cartDrawer")?.classList.remove("hidden");
}

function closeCart() {
  document.getElementById("cartDrawer")?.classList.add("hidden");
}

function setupEvents() {
  document.getElementById("cartToggleBtn")?.addEventListener("click", () => {
    renderCartDrawer();
    openCart();
  });
  document.getElementById("cartCloseBtn")?.addEventListener("click", closeCart);
  document.getElementById("cartOverlay")?.addEventListener("click", closeCart);

  document.querySelectorAll(".pill").forEach(pill => {
    pill.addEventListener("click", (e) => {
      document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
      e.target.classList.add("active");
      activeCategory = e.target.dataset.category || "all";
      renderProducts();
    });
  });

  document.getElementById("searchInput")?.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderProducts();
  });

  document.getElementById("checkoutBtn")?.addEventListener("click", () => {
    if (!cart.length) {
      alert("Añade algún producto antes de finalizar el pedido.");
      return;
    }
    const total = cart.reduce((acc, item) => acc + item.price * item.qty, 0);
    closeCart();
    const modal = document.getElementById("checkoutModal");
    const summary = document.getElementById("checkoutSummaryText");
    if (summary) summary.textContent = \`Has realizado tu pedido de \${cart.length} productos por un total de $\${total.toFixed(2)}.\`;
    if (modal) modal.classList.remove("hidden");
    cart = [];
    updateCartBadge();
  });

  document.getElementById("modalCloseBtn")?.addEventListener("click", () => {
    document.getElementById("checkoutModal")?.classList.add("hidden");
  });
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}
`
    };
  }

  function getWebProjectFiles(threadId) {
    const tid = threadId || activeThreadId() || "default";
    try {
      let raw = localStorage.getItem(getProjectFilesKey(tid));
      if (!raw) {
        raw = localStorage.getItem(PROJECT_FILES_PREFIX + "anon:" + tid) ||
              localStorage.getItem(PROJECT_FILES_PREFIX + (currentUid() || "anon") + ":" + tid);
      }
      let files = raw ? JSON.parse(raw) : null;
      if (!files || typeof files !== "object") files = {};

      // Siempre asegurar que todos los archivos generados en los mensajes del chat estén sincronizados
      const msgs = loadMessages(tid);
      let recovered = false;
      for (const m of msgs) {
        if (m.role === "assistant" && m.content) {
          const blocks = extractCodeBlocks(m.content);
          for (const b of blocks) {
            if (b.filename && b.code && (!files[b.filename] || files[b.filename].length < b.code.length)) {
              files[b.filename] = b.code;
              recovered = true;
            }
          }
        }
      }

      // Si aún no hay archivos generados pero hay mensajes pidiendo crear app, web o tienda:
      if (!Object.keys(files).length && msgs.length > 0) {
        const fullPromptText = msgs.map(m => typeof m.content === "string" ? m.content : "").join(" ").toLowerCase();
        if (fullPromptText.includes("ventas") || fullPromptText.includes("tienda") || fullPromptText.includes("app") || fullPromptText.includes("catálogo") || fullPromptText.includes("catalogo") || fullPromptText.includes("crear") || fullPromptText.includes("hazlo")) {
          files = generateDefaultStoreProject();
          recovered = true;
          setWebProjectName(tid, "tienda-ventas");
        }
      }

      if (recovered || (!raw && Object.keys(files).length)) {
        saveWebProjectFiles(tid, files);
      }
      return files || {};
    } catch {
      return {};
    }
  }

  function saveWebProjectFiles(threadId, files) {
    try {
      localStorage.setItem(getProjectFilesKey(threadId), JSON.stringify(files || {}));
    } catch { /* ignore */ }
  }

  function getWebProjectName(threadId) {
    const tid = threadId || activeThreadId() || "default";
    try {
      const saved = localStorage.getItem("editcore-web-project-name:" + tid);
      if (saved) return saved;
      const files = getWebProjectFiles(tid);
      if (Object.keys(files).length > 0) return "proyecto-web";
      return "";
    } catch {
      return "";
    }
  }

  function setWebProjectName(threadId, name) {
    const tid = threadId || activeThreadId() || "default";
    try {
      if (name) localStorage.setItem("editcore-web-project-name:" + tid, name);
    } catch { /* ignore */ }
  }

  function inferProjectName(prompt) {
    const clean = String(prompt || "").toLowerCase();
    const match = clean.match(/(?:crea(?:r)?|arma(?:r)?|diseña(?:r)?|genera(?:r)?)\s+(?:un(?:a)?\s+)?([a-z0-9áéíóúñ\-_ ]{3,35})/i);
    if (match) {
      const slug = match[1].trim()
        .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
        .replace(/[^a-z0-9\- ]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      if (slug && slug.length >= 3) return slug;
    }
    return "proyecto-web";
  }

  function syncWebProjectFolder(threadId) {
    const tid = threadId || activeThreadId();
    const folderEl = $("chatHomeCtxFolder");
    if (!folderEl) return;
    const files = getWebProjectFiles(tid);
    const count = Object.keys(files).length;
    let projName = getWebProjectName(tid);
    if (!projName && count > 0) {
      projName = "proyecto-web";
      setWebProjectName(tid, projName);
    }
    if (projName) {
      folderEl.textContent = projName;
      folderEl.title = `Carpeta del proyecto: ${projName} (${count} archivo${count !== 1 ? 's' : ''})`;
      const card = $("chatHomeProjectCard");
      if (card) card.style.borderColor = "var(--ec-accent, #1b6f79)";
    } else {
      folderEl.textContent = "Sin carpeta";
    }
  }

  // Integración nativa con EditCoreSessionContext para que el IDE y chat-home no borren los archivos
  window.EditCoreSessionContext = {
    snapshot: async () => {
      const tid = activeThreadId();
      const files = getWebProjectFiles(tid);
      const projName = getWebProjectName(tid) || "proyecto-web";
      const filesChanged = Object.entries(files).map(([name, content]) => ({
        title: name,
        path: `${projName}/${name}`,
        meta: `${Math.ceil((content.length || 0) / 1024)} KB`,
        onClick: () => {
          switchContextTab("preview");
          renderWebPreview(tid, name);
        },
      }));
      return {
        filesChanged,
        subagents: [],
        artifacts: [],
        uploads: [],
        tasks: [],
        skills: [],
      };
    },
  };

  function extractCodeBlocks(text) {
    if (!text || typeof text !== "string") return [];
    const blocks = [];
    const seenFiles = new Set();

    function addBlock(filename, code) {
      if (!filename || !code || !code.trim()) return;
      filename = filename.trim().replace(/^['"`]|['"`]$/g, "");
      const lower = filename.toLowerCase();
      let cleanCode = code.trim();
      cleanCode = cleanCode.replace(/^```[a-zA-Z0-9_\-\.]*\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const existing = blocks.find((b) => b.filename.toLowerCase() === lower);
      if (existing) {
        existing.code = cleanCode;
      } else {
        blocks.push({ filename, code: cleanCode });
        seenFiles.add(lower);
      }
    }

    // 1. Bloques delimitados por comillas invertidas (cerrados o abiertos durante streaming)
    const fenceRegex = /```([a-zA-Z0-9_\-\.]+)?\s*([^\n]*)\n([\s\S]*?)(?:```|$)/g;
    let match;
    while ((match = fenceRegex.exec(text)) !== null) {
      const lang = (match[1] || "").toLowerCase().trim();
      const headerLine = (match[2] || "").trim();
      const code = match[3];
      let filename = "";

      // 1.1 Cabecera de la valla (ej. ```html index.html o ```html filepath: index.html)
      const headerMatch = headerLine.match(/(?:filepath:|filename:|file:)?\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i);
      if (headerMatch) filename = headerMatch[1];

      // 1.2 Primer comentario del código
      if (!filename) {
        const firstLine = code.split("\n")[0].trim();
        const fileMatch = firstLine.match(/^(?:<!--|\/\/|\/\*|#)\s*(?:filepath:|filename:|file:)?\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i);
        if (fileMatch) filename = fileMatch[1];
      }

      // 1.3 Inferencia inteligente por lenguaje y sintaxis
      if (!filename) {
        if (lang === "html" || code.includes("<!DOCTYPE") || code.includes("<html") || code.includes("<body")) {
          filename = "index.html";
        } else if (lang === "css" || (code.includes("{") && (code.includes("margin:") || code.includes("display:") || code.includes("background:") || code.includes("padding:")))) {
          filename = "styles.css";
        } else if (lang === "js" || lang === "javascript" || (code.includes("document.") || code.includes("addEventListener") || code.includes("function") || code.includes("const "))) {
          filename = "app.js";
        } else if (lang === "json" || code.includes('"dependencies"') || code.includes('"scripts"')) {
          filename = "package.json";
        }
      }
      if (filename) addBlock(filename, code);
    }

    // 2. Archivos sin comillas invertidas (etiquetados con // filepath:, /* filepath: */, <!-- filepath: -->, etc.)
    const markerRegex = /(?:^|\n)(?:<!--|\/\/|\/\*|#|###|##|\*\*|--)?\s*(?:filepath:|filename:|file:)?\s*([a-zA-Z0-9_\-\.\/]+\.(?:html|htm|css|js|jsx|ts|tsx|json|svg|md|txt))(?:\s*(?:-->|\*\/|\*\*|--))?\s*(?:\n|$)/gi;
    const markers = [];
    let mm;
    while ((mm = markerRe.exec(text)) !== null) {
      markers.push({ filename: mm[1], start: mm.index + mm[0].length, headerStart: mm.index });
    }
    for (let i = 0; i < markers.length; i++) {
      const curr = markers[i];
      const nextStart = (i + 1 < markers.length) ? markers[i + 1].headerStart : text.length;
      const chunk = text.slice(curr.start, nextStart);
      if (chunk && chunk.trim()) {
        addBlock(curr.filename, chunk);
      }
    }

    // 3. Respaldo para documentos HTML completos directos sin etiqueta
    if (!seenFiles.has("index.html")) {
      const docIdx = text.search(/<!DOCTYPE\s+html|<html/i);
      if (docIdx !== -1) {
        const endIdx = text.search(/<\/html>/i);
        const htmlCode = endIdx !== -1 ? text.slice(docIdx, endIdx + 7) : text.slice(docIdx);
        if (htmlCode && htmlCode.trim()) addBlock("index.html", htmlCode);
      }
    }

    return blocks;
  }

  function updateProjectFromTurn(threadId, text) {
    const blocks = extractCodeBlocks(text);
    if (!blocks.length) return;
    const files = getWebProjectFiles(threadId);
    let changed = false;
    for (const b of blocks) {
      if (b.filename && b.code) {
        files[b.filename] = b.code;
        changed = true;
      }
    }
    if (changed) {
      saveWebProjectFiles(threadId, files);
      syncWebProjectFolder(threadId);
      refreshProjectFilesUI(threadId);
      renderWebPreview(threadId);
    }
  }

  function refreshProjectFilesUI(threadId) {
    const tid = threadId || activeThreadId();
    syncWebProjectFolder(tid);
    const files = getWebProjectFiles(tid);
    const list = $("chatHomeCtxFiles");
    if (!list) return;
    list.replaceChildren();
    const entries = Object.entries(files);
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "chat-home-context-empty";
      empty.textContent = "Sin archivos generados todavía.";
      list.appendChild(empty);
      return;
    }
    for (const [filename, content] of entries) {
      const li = document.createElement("li");
      li.className = "chat-home-ctx-file-item";
      li.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:6px;background:var(--ch-surface,#f8fafc);border:1px solid var(--ch-border,#e2e8f0);margin-bottom:6px;cursor:pointer;font-size:12px;transition:background 0.1s ease;";
      li.onmouseenter = () => { li.style.background = "var(--ch-hover,#e2e8f0)"; };
      li.onmouseleave = () => { li.style.background = "var(--ch-surface,#f8fafc)"; };

      const nameSpan = document.createElement("span");
      const icon = filename.endsWith(".html") ? "🌐 " : (filename.endsWith(".css") ? "🎨 " : (filename.endsWith(".js") ? "⚡ " : "📄 "));
      nameSpan.textContent = icon + filename;
      nameSpan.style.cssText = "font-weight:600;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

      const sizeSpan = document.createElement("span");
      sizeSpan.textContent = `${Math.ceil((content.length || 0) / 1024)} KB`;
      sizeSpan.style.cssText = "color:var(--ch-text-muted,#64748b);font-size:10px;margin-left:8px;font-family:monospace;";

      li.appendChild(nameSpan);
      li.appendChild(sizeSpan);
      li.title = `Clic para abrir y previsualizar ${filename}`;
      li.addEventListener("click", () => {
        switchContextTab("preview");
        renderWebPreview(tid, filename);
      });
      list.appendChild(li);
    }
  }

  function buildPreviewHtml(files, activeFile = "") {
    if (!files || !Object.keys(files).length) return "";
    let html = files["index.html"] || (activeFile && files[activeFile]?.includes("<html") ? files[activeFile] : "");
    if (!html) {
      const htmlKey = Object.keys(files).find((k) => k.endsWith(".html"));
      if (htmlKey) html = files[htmlKey];
    }

    const cssEntries = Object.entries(files).filter(([k]) => k.endsWith(".css"));
    const jsEntries = Object.entries(files).filter(([k]) => {
      const lower = k.toLowerCase();
      return lower.endsWith(".js") &&
        !lower.includes("package") &&
        !lower.includes("config") &&
        !lower.endsWith(".test.js") &&
        !lower.endsWith(".spec.js") &&
        lower !== "sw.js" &&
        !lower.endsWith("/sw.js") &&
        !lower.includes("service-worker") &&
        !lower.includes(".worker.");
    });

    const shimScript = `<script id="editcore-preview-shim">
(function() {
  function createSafeStorage() {
    var store = {};
    return {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v) { store[k] = String(v); },
      removeItem: function(k) { delete store[k]; },
      clear: function() { store = {}; },
      key: function(i) { return Object.keys(store)[i] || null; },
      get length() { return Object.keys(store).length; }
    };
  }
  try {
    window.localStorage && window.localStorage.getItem('_test');
  } catch (e) {
    var _ls = createSafeStorage();
    try {
      Object.defineProperty(window, 'localStorage', {
        get: function() { return _ls; },
        configurable: true,
        enumerable: true
      });
    } catch (_) {
      try { window.localStorage = _ls; } catch (__) {}
    }
  }
  try {
    window.sessionStorage && window.sessionStorage.getItem('_test');
  } catch (e) {
    var _ss = createSafeStorage();
    try {
      Object.defineProperty(window, 'sessionStorage', {
        get: function() { return _ss; },
        configurable: true,
        enumerable: true
      });
    } catch (_) {
      try { window.sessionStorage = _ss; } catch (__) {}
    }
  }
  if (typeof window.skipWaiting !== 'function') {
    window.skipWaiting = function() { return Promise.resolve(); };
  }
  try {
    Object.defineProperty(window.navigator, 'serviceWorker', {
      get: function() {
        return {
          register: function() {
            return Promise.resolve({ scope: './', active: null, installing: null, waiting: null, update: function() { return Promise.resolve(); } });
          },
          getRegistration: function() { return Promise.resolve(); },
          getRegistrations: function() { return Promise.resolve([]); },
          addEventListener: function() {},
          removeEventListener: function() {}
        };
      },
      configurable: true
    });
  } catch (_) {}
  var _origDocAdd = document.addEventListener;
  document.addEventListener = function(type, fn, opts) {
    if (type === 'DOMContentLoaded' && (document.readyState === 'interactive' || document.readyState === 'complete')) {
      setTimeout(fn, 1);
      return;
    }
    return _origDocAdd.call(document, type, fn, opts);
  };
  var _origWinAdd = window.addEventListener;
  window.addEventListener = function(type, fn, opts) {
    if (type === 'load' && document.readyState === 'complete') {
      setTimeout(fn, 1);
      return;
    }
    return _origWinAdd.call(window, type, fn, opts);
  };
  window.addEventListener('error', function(e) {
    console.warn('[EditCore Preview Notice]', e.error || e.message);
    var body = document.body;
    if (body && (!body.children.length || (body.children.length === 1 && document.getElementById('app') && !document.getElementById('app').innerHTML.trim()))) {
      var banner = document.getElementById('editcore-error-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'editcore-error-banner';
        banner.style.cssText = 'margin:24px;padding:16px 20px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-family:system-ui,sans-serif;color:#991b1b;';
        banner.innerHTML = '<strong style="display:block;margin-bottom:6px;font-size:14px;">Aviso de ejecución en vista previa:</strong><span style="font-size:12px;opacity:0.9;">' + (e.message || 'Error en script del proyecto') + '</span>';
        body.appendChild(banner);
      }
    }
  });
})();
<\/script>`;

    if (!html) {
      const cssBlocks = cssEntries.map(([k, code]) => `/* ${k} */\n${code}`).join("\n\n");
      const jsBlocks = jsEntries.map(([k, code]) => `// ${k}\n${code}`).join("\n\n");
      return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preview</title>
  ${shimScript}
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 20px; background: #fff; color: #1e293b; }
    ${cssBlocks}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>${jsBlocks}<\/script>
</body>
</html>`;
    }

    let bundle = html;

    if (!bundle.includes("<html") && !bundle.includes("<!DOCTYPE")) {
      bundle = `<!DOCTYPE html>\n<html lang="es">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Preview</title>\n</head>\n<body>\n${bundle}\n</body>\n</html>`;
    }

    // Inyectar el shim de almacenamiento al principio de head
    if (bundle.includes("<head>")) {
      bundle = bundle.replace("<head>", `<head>\n${shimScript}`);
    } else if (bundle.includes("</title>")) {
      bundle = bundle.replace("</title>", `</title>\n${shimScript}`);
    } else {
      bundle = shimScript + bundle;
    }

    // Reemplazar o inyectar estilos CSS
    const injectedCss = new Set();
    for (const [filename, code] of cssEntries) {
      const base = filename.split("/").pop();
      const rx = new RegExp(`<link[^>]+(?:href=["'][^"']*${base}["']|rel=["']stylesheet["'][^>]*href=["'][^"']*${base}["'])[^>]*>`, "gi");
      if (rx.test(bundle)) {
        bundle = bundle.replace(rx, `<style data-file="${filename}">\n${code}\n</style>`);
        injectedCss.add(filename);
      }
    }
    const remainingCss = cssEntries.filter(([k]) => !injectedCss.has(k)).map(([k, code]) => `/* ${k} */\n${code}`).join("\n\n");
    if (remainingCss) {
      const tag = `<style id="editcore-styles">\n${remainingCss}\n</style>`;
      if (bundle.includes("</head>")) {
        bundle = bundle.replace("</head>", `${tag}\n</head>`);
      } else {
        bundle = tag + bundle;
      }
    }

    // Reemplazar o inyectar scripts JS
    const injectedJs = new Set();
    for (const [filename, code] of jsEntries) {
      const base = filename.split("/").pop();
      const rx = new RegExp(`<script[^>]+src=["'][^"']*${base}["'][^>]*>\\s*<\\/script>`, "gi");
      if (rx.test(bundle)) {
        bundle = bundle.replace(rx, `<script data-file="${filename}">\n${code}\n<\/script>`);
        injectedJs.add(filename);
      }
    }
    const remainingJs = jsEntries.filter(([k]) => !injectedJs.has(k)).map(([k, code]) => `// ${k}\n${code}`).join("\n\n");
    if (remainingJs) {
      const tag = `<script id="editcore-app">\n${remainingJs}\n<\/script>`;
      if (bundle.includes("</body>")) {
        bundle = bundle.replace("</body>", `${tag}\n</body>`);
      } else {
        bundle = bundle + tag;
      }
    }

    return bundle;
  }

  function renderWebPreview(threadId, activeFile = "") {
    const iframe = $("webPreviewIframe");
    const emptyEl = $("webPreviewEmpty");
    if (!iframe) return;
    const files = getWebProjectFiles(threadId);
    if (!Object.keys(files).length) {
      iframe.srcdoc = "";
      iframe.style.display = "none";
      if (emptyEl) emptyEl.style.display = "flex";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";
    iframe.style.display = "block";
    const compiled = buildPreviewHtml(files, activeFile);
    iframe.srcdoc = compiled;
    const urlLabel = $("webPreviewUrlLabel");
    const projName = getWebProjectName(threadId) || "app";
    if (urlLabel) urlLabel.textContent = `editcore://${projName}/${activeFile || "index.html"}`;
  }

  function ensureJSZip() {
    if (typeof window.JSZip !== "undefined") return Promise.resolve(window.JSZip);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => reject(new Error("No se pudo cargar el motor ZIP."));
      document.head.appendChild(s);
    });
  }

  async function downloadWebProjectZip(threadId) {
    try {
      await ensureJSZip();
    } catch {
      alert("No se pudo cargar el motor de compresión ZIP. Por favor revisa tu conexión a internet.");
      return;
    }
    const files = getWebProjectFiles(threadId);
    if (!Object.keys(files).length) {
      alert("No hay archivos generados en esta conversación todavía. Pide a EditCoreAI que cree código primero.");
      return;
    }
    const zip = new JSZip();
    const projName = getWebProjectName(threadId) || "editcore-web-project";
    if (!files["package.json"]) {
      zip.file("package.json", JSON.stringify({
        name: projName,
        version: "1.0.0",
        private: true,
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
        },
        devDependencies: {
          vite: "^5.4.0",
        },
      }, null, 2));
    }
    if (!files["README.md"]) {
      zip.file("README.md", `# ${projName}\n\nProyecto exportado desde EditCoreAI Web (www.editcore.mx).\n\n## Puesta en marcha\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`);
    }
    for (const [filename, content] of Object.entries(files)) {
      zip.file(filename, content);
    }
    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projName}-${Date.now().toString(36)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error generando el archivo ZIP: " + (err?.message || err));
    }
  }

  function toggleContextExpand(forceState) {
    const panel = $("chatHomeContextPanel");
    if (!panel) return;
    const isExpanded = typeof forceState === "boolean" ? forceState : !panel.classList.contains("is-expanded");
    panel.classList.toggle("is-expanded", isExpanded);

    const btnContext = $("webContextWidthToggleBtn");
    if (btnContext) {
      btnContext.textContent = isExpanded ? "⇱ Regresar" : "⇲ Expandir";
      btnContext.title = isExpanded ? "Regresar al panel derecho (380px)" : "Expandir panel (50%)";
    }
    try {
      localStorage.setItem("editcore-panel-expanded", isExpanded ? "true" : "false");
    } catch { /* ignore */ }
  }

  function switchContextTab(key) {
    const tabs = document.querySelectorAll(".chat-home-context-tab");
    tabs.forEach((tab) => {
      const match = tab.getAttribute("data-ctx-tab") === key;
      tab.classList.toggle("is-active", match);
      tab.setAttribute("aria-selected", match ? "true" : "false");
    });

    const isPreview = (key === "preview");
    const secSession = $("chatHomeCtxSecSession");
    const secPreview = $("chatHomeCtxSecPreview");
    const secTasks = $("chatHomeCtxSecTasks");

    if (secSession) secSession.hidden = isPreview;
    if (secPreview) secPreview.hidden = !isPreview;
    if (secTasks) secTasks.hidden = true;

    const title = $("chatHomeContextTitle");
    if (title) title.textContent = isPreview ? "Navegador Web" : "Proyecto & Archivos";

    const panel = $("chatHomeContextPanel");
    if (panel) {
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
    }
  }

  // ─── CONEXIONES DE USUARIO (GitHub, Vercel, Supabase) ──────────────────────
  const CONNECTIONS_KEY = "editcore-web-user-connections";

  function getWebConnections() {
    try {
      return JSON.parse(localStorage.getItem(CONNECTIONS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveWebConnections(conns) {
    try {
      localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(conns || {}));
    } catch { /* ignore */ }
  }

  function initWebConnectionsUI() {
    const conns = getWebConnections();
    
    // GitHub
    const ghInput = $("webGithubTokenInput");
    const ghTag = $("webGithubStatusTag");
    if (ghInput && conns.githubToken) {
      ghInput.value = conns.githubToken;
      if (ghTag) {
        ghTag.className = "ec-status-tag ec-tag-success";
        ghTag.textContent = "Conectado";
      }
    }
    $("webSaveGithubBtn")?.addEventListener("click", () => {
      const val = String(ghInput?.value || "").trim();
      conns.githubToken = val;
      saveWebConnections(conns);
      if (ghTag) {
        ghTag.className = val ? "ec-status-tag ec-tag-success" : "ec-status-tag";
        ghTag.textContent = val ? "Conectado" : "Sin conectar";
      }
      alert(val ? "Token de GitHub guardado exitosamente." : "Conexión de GitHub eliminada.");
    });

    // Vercel
    const vInput = $("webVercelTokenInput");
    const vTag = $("webVercelStatusTag");
    if (vInput && conns.vercelToken) {
      vInput.value = conns.vercelToken;
      if (vTag) {
        vTag.className = "ec-status-tag ec-tag-success";
        vTag.textContent = "Conectado";
      }
    }
    $("webSaveVercelBtn")?.addEventListener("click", () => {
      const val = String(vInput?.value || "").trim();
      conns.vercelToken = val;
      saveWebConnections(conns);
      if (vTag) {
        vTag.className = val ? "ec-status-tag ec-tag-success" : "ec-status-tag";
        vTag.textContent = val ? "Conectado" : "Sin conectar";
      }
      alert(val ? "Token de Vercel guardado exitosamente." : "Conexión de Vercel eliminada.");
    });

    // Supabase
    const sUrlInput = $("webSupabaseUrlInput");
    const sKeyInput = $("webSupabaseKeyInput");
    const sTag = $("webSupabaseStatusTag");
    if (sUrlInput && conns.supabaseUrl) sUrlInput.value = conns.supabaseUrl;
    if (sKeyInput && conns.supabaseKey) sKeyInput.value = conns.supabaseKey;
    if (sTag && conns.supabaseUrl && conns.supabaseKey) {
      sTag.className = "ec-status-tag ec-tag-success";
      sTag.textContent = "Conectado";
    }
    $("webSaveSupabaseBtn")?.addEventListener("click", () => {
      const url = String(sUrlInput?.value || "").trim();
      const key = String(sKeyInput?.value || "").trim();
      conns.supabaseUrl = url;
      conns.supabaseKey = key;
      saveWebConnections(conns);
      if (sTag) {
        const ok = url && key;
        sTag.className = ok ? "ec-status-tag ec-tag-success" : "ec-status-tag";
        sTag.textContent = ok ? "Conectado" : "Sin conectar";
      }
      alert(url && key ? "Credenciales de Supabase guardadas." : "Conexión de Supabase actualizada.");
    });
  }

  // ── Arranque: cosas de la web que el IDE no necesita ─────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const prompt = $("chatHomePrompt");
    if (prompt) {
      prompt.placeholder = "Pregunta a EditCoreAI: crea una app, una web, código…";
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

    // Selector de archivos y capturas con botón +
    $("chatHomePlusBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      $("fileInput")?.click();
    });
    $("fileInput")?.addEventListener("change", (e) => {
      if (e.target.files?.length) {
        void addAttachmentFiles(e.target.files);
        e.target.value = "";
      }
    });

    // Pegar capturas de pantalla desde el portapapeles (Ctrl+V)
    const handlePasteAttach = (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const items = Array.from(cd.items || []);
      const imgFiles = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) imgFiles.push(f);
        }
      }
      if (imgFiles.length) {
        e.preventDefault();
        void addAttachmentFiles(imgFiles);
      }
    };
    $("chatHomePrompt")?.addEventListener("paste", handlePasteAttach);
    $("chatHomeComposer")?.addEventListener("paste", handlePasteAttach);

    // Arrastrar y soltar archivos / capturas en el composer del chat
    const composer = $("chatHomeComposer");
    if (composer) {
      composer.addEventListener("dragover", (e) => {
        e.preventDefault();
        composer.classList.add("drag-over");
      });
      composer.addEventListener("dragleave", () => composer.classList.remove("drag-over"));
      composer.addEventListener("drop", (e) => {
        e.preventDefault();
        composer.classList.remove("drag-over");
        if (e.dataTransfer?.files?.length) void addAttachmentFiles(e.dataTransfer.files);
      });
    }

    // Dictado por voz / micrófono
    $("chatHomeMicBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        alert("El dictado por voz requiere Google Chrome o Microsoft Edge.");
        return;
      }
      const btn = $("chatHomeMicBtn");
      if (window.__ecSpeechRec) {
        try { window.__ecSpeechRec.stop(); } catch (_) {}
        window.__ecSpeechRec = null;
        btn?.classList.remove("is-recording");
        return;
      }
      try {
        const rec = new SR();
        rec.lang = "es-ES";
        rec.continuous = false;
        rec.interimResults = false;
        rec.onstart = () => btn?.classList.add("is-recording");
        rec.onresult = (ev) => {
          const transcript = ev.results?.[0]?.[0]?.transcript || "";
          const p = $("chatHomePrompt");
          if (p && transcript) {
            p.value = (p.value ? p.value + " " : "") + transcript;
            p.focus();
          }
        };
        rec.onerror = () => { btn?.classList.remove("is-recording"); window.__ecSpeechRec = null; };
        rec.onend = () => { btn?.classList.remove("is-recording"); window.__ecSpeechRec = null; };
        window.__ecSpeechRec = rec;
        rec.start();
      } catch (err) {
        btn?.classList.remove("is-recording");
        window.__ecSpeechRec = null;
      }
    });

    // Botones de descarga de proyecto ZIP
    $("webTopDownloadProjectBtn")?.addEventListener("click", () => downloadWebProjectZip(activeThreadId()));
    $("webSideDownloadBtn")?.addEventListener("click", () => downloadWebProjectZip(activeThreadId()));

    // Controles del Previsualizador Web en Vivo
    $("chatHomePreviewTabBtn")?.addEventListener("click", () => {
      switchContextTab("preview");
      renderWebPreview(activeThreadId());
    });
    $("chatHomeOpenPreviewBtn")?.addEventListener("click", () => {
      switchContextTab("preview");
      renderWebPreview(activeThreadId());
    });
    $("webPreviewReloadBtn")?.addEventListener("click", () => renderWebPreview(activeThreadId()));
    $("webPreviewMobileBtn")?.addEventListener("click", () => {
      const vp = $("webPreviewViewport");
      const btn = $("webPreviewMobileBtn");
      if (!vp) return;
      const isMobile = vp.classList.toggle("is-mobile");
      if (btn) {
        btn.classList.toggle("is-active", isMobile);
        btn.textContent = isMobile ? "📱 Ancho normal" : "📱 Móvil";
      }
    });
    $("webContextWidthToggleBtn")?.addEventListener("click", () => toggleContextExpand());

    // Restaurar preferencia de ancho si estaba expandido
    try {
      if (localStorage.getItem("editcore-panel-expanded") === "true") {
        toggleContextExpand(true);
      }
    } catch { /* ignore */ }

    // Pestañas del panel derecho
    document.querySelectorAll(".chat-home-context-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const key = tab.getAttribute("data-ctx-tab");
        if (key) switchContextTab(key);
      });
    });

    // Inicializar conexiones
    initWebConnectionsUI();

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
      setTimeout(() => {
        const tid = activeThreadId();
        renderThread(tid);
        refreshProjectFilesUI(tid);
        renderWebPreview(tid);
      }, 0);
    });
  });
})();
