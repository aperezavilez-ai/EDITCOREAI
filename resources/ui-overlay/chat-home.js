"use strict";

/**
 * Chat Agent Home — UI tipo Cursor (sin recuadros).
 * Composer propio → Agent Core. Model picker real. Mic + Settings.
 */
(function initChatHome() {
  const STORAGE_KEY = "editcore-chat-home-v1";
  const MODE_KEY = "editcore-app-mode";

  function $(id) {
    return document.getElementById(id);
  }

  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        threads: Array.isArray(raw.threads) ? raw.threads : [],
        activeId: String(raw.activeId || ""),
        search: "",
      };
    } catch {
      return { threads: [], activeId: "", search: "" };
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        threads: store.threads.slice(0, 80),
        activeId: store.activeId,
      }));
    } catch { /* ignore */ }
  }

  const store = loadStore();

  const SVG_ICONS = {
    folder: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
    file: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    git: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
    docs: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    web: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    test: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 2-8.5 8.5a4.95 4.95 0 0 0 0 7 4.95 4.95 0 0 0 7 0L21.5 9"/><path d="m8.5 8 7 7"/></svg>`,
    commit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22.95" y2="12"/></svg>`,
    explain: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
    refactor: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    fix: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    audit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    db: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
    sparkle: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`,
  };

  function createSvgIcon(type, size = 14) {
    const raw = SVG_ICONS[type] || SVG_ICONS.sparkle;
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (svg) {
      if (size) {
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
      }
      svg.setAttribute("aria-hidden", "true");
      return svg;
    }
    const span = document.createElement("span");
    return span;
  }

  function uid() {
    return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getThreads() {
    if (typeof window.getChatThreads === "function") {
      try {
        const fromRenderer = window.getChatThreads();
        if (Array.isArray(fromRenderer) && fromRenderer.length) {
          return fromRenderer;
        }
      } catch { /* ignore */ }
    }
    const projects = window.state?.projects || [];
    const list = [];
    const currentProjId = window.state?.activeProjectId;
    for (const p of projects) {
      const pName = p.title && p.title !== "Nuevo chat" ? p.title : (p.projectRoot ? p.projectRoot.split(/[\\/]/).filter(Boolean).pop() : "");
      for (const c of (p.chats || [])) {
        list.push({
          id: c.id,
          title: c.title || "Conversación",
          updatedAt: c.updatedAt || c.createdAt || Date.now(),
          createdAt: c.createdAt || Date.now(),
          projectId: p.id,
          projectRoot: p.projectRoot || "",
          projectName: pName,
          messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
          isActive: c.id === p.activeChatId && p.id === currentProjId,
        });
      }
    }
    if (list.length) return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return store.threads;
  }

  function getActiveThreadId() {
    if (typeof window.getActiveChatThreadId === "function") {
      try {
        const id = window.getActiveChatThreadId();
        if (id) return id;
      } catch { /* ignore */ }
    }
    const curProj = window.state?.projects?.find?.((p) => p.id === window.state?.activeProjectId);
    return curProj?.activeChatId || store.activeId || (store.threads[0]?.id) || "";
  }

  function ensureThread() {
    const list = getThreads();
    if (!list.length) {
      const t = {
        id: uid(),
        title: "Nueva conversación",
        updatedAt: Date.now(),
        createdAt: Date.now(),
      };
      store.threads.unshift(t);
      store.activeId = t.id;
      saveStore(store);
      return t;
    }
    const activeId = getActiveThreadId();
    if (!store.activeId || !list.some((t) => t.id === store.activeId)) {
      store.activeId = activeId || list[0].id;
      saveStore(store);
    }
    return list.find((t) => t.id === store.activeId) || list[0];
  }

  function setMode(mode) {
    const next = mode === "ide" ? "ide" : "chat";
    const prev = document.body.dataset.appMode || "chat";
    if (prev === next && document.body.dataset.editcoreReady === "1") {
      // Ya estamos en ese modo: solo asegurar mount mínimo.
      if (next === "chat") {
        mountFeedIntoHome();
        remountIdeComposer();
      } else {
        remountFeedIntoIde();
      }
      return;
    }
    document.body.dataset.appMode = next;
    try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
    const shell = $("chatHomeShell");
    if (shell) {
      shell.hidden = next !== "chat";
      shell.setAttribute("aria-hidden", next === "chat" ? "false" : "true");
    }
    if (next === "chat") {
      mountFeedIntoHome();
      remountIdeComposer();
      syncFolderChip();
      syncModelPill();
      syncCrumb();
      renderThreadList();
      syncEmptyState();
      closeSettings();
      setContextPanelOpen(true);
      $("chatHomePrompt")?.focus();
    } else {
      remountFeedIntoIde();
      closeSettings();
      setContextPanelOpen(false);
      try { window.EditCoreModels?.closePicker?.(); } catch { /* ignore */ }
    }
    window.dispatchEvent(new CustomEvent("editcore:app-mode", { detail: { mode: next } }));
  }

  function mountFeedIntoHome() {
    const feedHost = $("chatHomeFeedHost");
    const feed = $("feed");
    if (feedHost && feed && feed.parentElement !== feedHost) feedHost.appendChild(feed);
  }

  function remountFeedIntoIde() {
    const main = document.querySelector("body > main");
    const feed = $("feed");
    const form = $("chatForm");
    if (!main || !feed) return;
    if (feed.parentElement !== main) {
      if (form && form.parentElement === main) main.insertBefore(feed, form);
      else main.appendChild(feed);
    }
  }

  function remountIdeComposer() {
    const main = document.querySelector("body > main");
    const form = $("chatForm");
    if (main && form && form.parentElement !== main) main.appendChild(form);
  }

  function syncEmptyState() {
    const stage = $("chatHomeStage");
    const feed = $("feed");
    if (!stage) return;
    const hasMsgs = Boolean(feed && feed.children && feed.children.length > 0);
    stage.classList.toggle("has-messages", hasMsgs);
  }

  function fillContextList(listEl, countEl, items, emptyLabel) {
    if (!listEl) return;
    listEl.replaceChildren();
    const rows = Array.isArray(items) ? items : [];
    if (countEl) countEl.textContent = String(rows.length);
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "ctx-empty";
      li.textContent = emptyLabel || "Ninguno";
      listEl.appendChild(li);
      return;
    }
    for (const item of rows.slice(0, 40)) {
      const li = document.createElement("li");
      const title = document.createElement("span");
      title.textContent = item.title || item.name || item.path || String(item);
      li.appendChild(title);
      if (item.meta) {
        const meta = document.createElement("span");
        meta.className = "ctx-meta";
        meta.textContent = item.meta;
        li.appendChild(meta);
      }
      if (typeof item.onClick === "function") {
        li.style.cursor = "pointer";
        li.addEventListener("click", item.onClick);
      }
      listEl.appendChild(li);
    }
  }

  async function refreshContextPanel() {
    const snap = typeof window.EditCoreSessionContext?.snapshot === "function"
      ? await window.EditCoreSessionContext.snapshot()
      : {};
    fillContextList(
      $("chatHomeCtxSubagents"),
      $("chatHomeCtxSubagentsCount"),
      snap.subagents || [],
      "Sin subagentes activos",
    );
    fillContextList(
      $("chatHomeCtxFiles"),
      $("chatHomeCtxFilesCount"),
      snap.filesChanged || [],
      "Sin archivos modificados en esta sesión",
    );
    fillContextList(
      $("chatHomeCtxArtifacts"),
      $("chatHomeCtxArtifactsCount"),
      snap.artifacts || [],
      "Sin artefactos",
    );
    fillContextList(
      $("chatHomeCtxUploads"),
      $("chatHomeCtxUploadsCount"),
      snap.uploads || [],
      "Sin adjuntos",
    );
    fillContextList(
      $("chatHomeCtxTasks"),
      $("chatHomeCtxTasksCount"),
      snap.tasks || [],
      "Sin tareas en segundo plano",
    );
    fillContextList(
      $("chatHomeCtxSkills"),
      $("chatHomeCtxSkillsCount"),
      snap.skills || [],
      "Sin skills activas",
    );
  }

  function setContextPanelOpen(open) {
    const panel = $("chatHomeContextPanel");
    const btn = $("chatHomeContextBtn");
    const dock = $("chatHomeContextDock");
    if (!panel) return;
    const next = open === true;
    panel.hidden = !next;
    panel.setAttribute("aria-hidden", next ? "false" : "true");
    btn?.classList.toggle("is-active", next);
    btn?.setAttribute("aria-selected", next ? "true" : "false");
    if (dock) dock.hidden = next;
    try { localStorage.setItem("editcore-session-panel-open", next ? "true" : "false"); } catch { /* ignore */ }
    if (next) void refreshContextPanel();
  }

  function initContextPanelState() {
    let saved = false;
    try { saved = localStorage.getItem("editcore-session-panel-open") === "true"; } catch { saved = false; }
    setContextPanelOpen(saved);
  }

  function toggleContextPanel() {
    const panel = $("chatHomeContextPanel");
    setContextPanelOpen(Boolean(panel?.hidden));
  }

  function selectContextTab(tab) {
    const key = String(tab || "session");
    const title = $("chatHomeContextTitle");
    const labels = {
      session: "Sesión",
      files: "Files Changed",
      tasks: "Background Tasks",
    };
    document.querySelectorAll(".chat-home-context-tab").forEach((el) => {
      const on = el.getAttribute("data-ctx-tab") === key;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (title) title.textContent = labels[key] || "Sesión";
    setContextPanelOpen(true);
    const map = {
      session: "chatHomeCtxSecSubagents",
      files: "chatHomeCtxSecFiles",
      tasks: "chatHomeCtxSecTasks",
    };
    const target = $(map[key] || map.session);
    try { target?.scrollIntoView?.({ block: "start", behavior: "smooth" }); } catch { /* ignore */ }
  }

  function syncCrumb() {
    const crumb = $("chatHomeCrumb");
    if (!crumb) return;
    const curProj = window.state?.projects?.find?.((p) => p.id === window.state?.activeProjectId)
      || (Array.isArray(window.state?.projects) ? window.state.projects[0] : null);
    const root = String(window.state?.projectRoot || curProj?.projectRoot || "").trim();
    const projectName = curProj?.title && curProj.title !== "Nuevo chat" && curProj.title !== "Proyecto"
      ? curProj.title 
      : (root ? (root.split(/[\\/]/).filter(Boolean).pop() || root) : (curProj?.name && curProj.name !== "Proyecto" ? curProj.name : ""));
    const activeId = getActiveThreadId();
    const thread = getThreads().find((t) => t.id === activeId) || getThreads().find((t) => t.id === store.activeId);
    const chatTitle = String(thread?.title || "Nueva conversación").trim() || "Nueva conversación";

    crumb.replaceChildren();
    if (projectName) {
      const folderBadge = document.createElement("span");
      folderBadge.className = "chat-home-crumb-folder";
      folderBadge.title = root ? `Carpeta: ${root}` : `Proyecto: ${projectName}`;
      const folderIcon = document.createElement("span");
      folderIcon.className = "chat-home-crumb-folder-icon";
      folderIcon.replaceChildren(createSvgIcon("folder", 13));
      const folderName = document.createElement("span");
      folderName.textContent = projectName;
      folderBadge.appendChild(folderIcon);
      folderBadge.appendChild(folderName);
      folderBadge.addEventListener("click", () => void connectFolder());

      const slash = document.createElement("span");
      slash.className = "chat-home-crumb-slash";
      slash.textContent = "/";

      const titleEl = document.createElement("span");
      titleEl.className = "chat-home-crumb-title";
      titleEl.textContent = chatTitle;

      crumb.append(folderBadge, slash, titleEl);
      crumb.title = root ? `${root} / ${chatTitle}` : `${projectName} / ${chatTitle}`;
    } else {
      const titleEl = document.createElement("span");
      titleEl.className = "chat-home-crumb-title";
      titleEl.textContent = chatTitle;
      crumb.appendChild(titleEl);
      crumb.title = chatTitle;
    }
  }

  function syncFolderChip() {
    const chip = $("chatHomeFolderChip");
    if (!chip) return;
    const root = String(window.state?.projectRoot || "").trim();
    if (root) {
      chip.classList.add("is-on");
      chip.replaceChildren();
      const icon = document.createElement("span");
      icon.className = "chat-home-folder-chip-icon";
      icon.replaceChildren(createSvgIcon("folder", 13));
      const nameEl = document.createElement("span");
      nameEl.className = "chat-home-folder-chip-name";
      const name = root.split(/[\\/]/).filter(Boolean).pop() || root;
      nameEl.textContent = name;
      chip.appendChild(icon);
      chip.appendChild(nameEl);
      chip.title = `Carpeta: ${root} (Clic para conectar otra)`;
      chip.onclick = () => void connectFolder();
    } else {
      chip.classList.remove("is-on");
      chip.replaceChildren();
    }
    syncCrumb();
  }

  function syncModelPill() {
    const pill = $("chatHomeModelPill");
    const label = String(
      $("modelPickerLabel")?.textContent
      || document.querySelector("#model option:checked")?.textContent
      || "Auto · ME AI"
    ).trim();
    if (pill) pill.textContent = `${label.slice(0, 34)} ▾`;
  }

  function openModelPicker() {
    const anchor = $("chatHomeModelPill");
    if (typeof window.EditCoreModels?.openPicker === "function") {
      window.EditCoreModels.openPicker(anchor);
      return;
    }
    // Fallback: click del picker del IDE (oculto pero funcional)
    $("modelPickerBtn")?.click();
  }

  function openSettings(panel = "main") {
    const sheet = $("chatHomeSettingsSheet");
    if (!sheet) return;
    showSettingsPanel(panel);
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    const sheet = $("chatHomeSettingsSheet");
    if (!sheet) return;
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    showSettingsPanel("main");
  }

  function showSettingsPanel(panel) {
    const main = $("chatHomeSettingsMain");
    const theme = $("chatHomeSettingsTheme");
    const perms = $("chatHomeSettingsPerms");
    const title = $("chatHomeSettingsTitle");
    const show = (el, on) => {
      if (!el) return;
      el.classList.toggle("is-hidden", !on);
      el.hidden = !on;
    };
    show(main, panel === "main");
    show(theme, panel === "theme");
    show(perms, panel === "permissions");
    if (title) {
      title.textContent = panel === "theme"
        ? "Apariencia"
        : panel === "permissions"
          ? "Permisos del agente"
          : "Settings";
    }
    if (panel === "theme") markActiveThemeButtons();
    if (panel === "permissions") markActivePermButtons();
  }

  function markActiveThemeButtons() {
    const current = window.EditCoreTheme?.get?.()
      || document.documentElement.getAttribute("data-theme")
      || "blanco";
    document.querySelectorAll("[data-ch-theme]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-ch-theme") === current);
    });
  }

  function markActivePermButtons() {
    const current = window.EditCorePermissions?.get?.() || "step";
    document.querySelectorAll("[data-ch-perm]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-ch-perm") === current);
    });
  }

  function runSetting(action) {
    if (action === "theme") {
      showSettingsPanel("theme");
      return;
    }
    if (action === "permissions") {
      showSettingsPanel("permissions");
      return;
    }
    closeSettings();
    // Diferir: el clic de Settings no debe cerrar el picker/menú en el mismo tick.
    const later = (fn) => {
      requestAnimationFrame(() => setTimeout(fn, 20));
    };
    if (action === "models") {
      later(() => {
        if (typeof window.EditCoreModels?.openPicker === "function") {
          openModelPicker();
        } else if (typeof window.EditCoreModels?.openProviders === "function") {
          window.EditCoreModels.openProviders();
        } else {
          $("providersBtn")?.click();
        }
      });
      return;
    }
    if (action === "skills") {
      later(() => openSkillsDialog());
      return;
    }
    if (action === "connections") {
      later(() => {
        if (typeof window.openConnections === "function") window.openConnections();
        else $("connectionsBtn")?.click();
      });
      return;
    }
    if (action === "ide") {
      setMode("ide");
    }
  }

  function applyThemeFromSettings(theme) {
    if (typeof window.EditCoreTheme?.apply === "function") {
      window.EditCoreTheme.apply(theme);
    } else {
      document.documentElement.setAttribute("data-theme", theme);
      try { localStorage.setItem("editcore-ui-theme", theme); } catch { /* ignore */ }
    }
    markActiveThemeButtons();
  }

  function applyPermFromSettings(mode) {
    if (typeof window.EditCorePermissions?.apply === "function") {
      window.EditCorePermissions.apply(mode);
    } else {
      $("permissionsBtn")?.click();
    }
    markActivePermButtons();
  }

  let cachedSkills = [];

  async function refreshSkillsList() {
    try {
      cachedSkills = (await window.editcoreSkills?.list?.()) || [];
    } catch (e) {
      console.warn("Error listing skills:", e);
      cachedSkills = [];
    }
    renderSkillsModalList();
  }

  function renderSkillsModalList() {
    const listEl = $("skillsList");
    const countEl = $("skillsCountLabel");
    if (!listEl) return;
    const filter = String($("skillsSearchInput")?.value || "").toLowerCase().trim();

    listEl.replaceChildren();
    const filtered = cachedSkills.filter((s) => {
      if (!filter) return true;
      return (
        (s.name && s.name.toLowerCase().includes(filter)) ||
        (s.description && s.description.toLowerCase().includes(filter)) ||
        (s.category && s.category.toLowerCase().includes(filter))
      );
    });

    const activeCount = cachedSkills.filter((s) => !s.disabled).length;
    if (countEl) {
      countEl.textContent = `${activeCount} de ${cachedSkills.length} habilidad(es) activa(s)`;
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "skill-empty-state";
      empty.textContent = filter ? "No se encontraron habilidades que coincidan con la búsqueda." : "No hay habilidades instaladas. ¡Agrega una nueva arriba o pídeselo al agente!";
      listEl.appendChild(empty);
      return;
    }

    for (const skill of filtered) {
      const card = document.createElement("div");
      card.className = `skill-card${skill.disabled ? " is-disabled" : ""}`;

      const top = document.createElement("div");
      top.className = "skill-card-top";

      const titleWrap = document.createElement("div");
      titleWrap.className = "skill-card-title-wrap";

      const nameEl = document.createElement("span");
      nameEl.className = "skill-card-name";
      nameEl.textContent = skill.name;
      titleWrap.appendChild(nameEl);

      const scopeBadge = document.createElement("span");
      scopeBadge.className = `skill-badge skill-badge-${skill.scope || "global"}`;
      scopeBadge.textContent = skill.scope === "builtin" ? "Sistema" : skill.scope === "project" ? "Proyecto" : "Global";
      titleWrap.appendChild(scopeBadge);

      if (skill.category) {
        const catBadge = document.createElement("span");
        catBadge.className = "skill-badge skill-badge-category";
        catBadge.textContent = skill.category;
        titleWrap.appendChild(catBadge);
      }
      top.appendChild(titleWrap);

      const toggleWrap = document.createElement("label");
      toggleWrap.style.display = "flex";
      toggleWrap.style.alignItems = "center";
      toggleWrap.style.gap = "6px";
      toggleWrap.style.fontSize = "12px";
      toggleWrap.style.cursor = "pointer";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = !skill.disabled;
      chk.addEventListener("change", async () => {
        try {
          await window.editcoreSkills?.toggle?.(skill.name, chk.checked);
          skill.disabled = !chk.checked;
          card.classList.toggle("is-disabled", skill.disabled);
          const newActive = cachedSkills.filter((s) => !s.disabled).length;
          if (countEl) countEl.textContent = `${newActive} de ${cachedSkills.length} habilidad(es) activa(s)`;
        } catch (err) {
          console.error("Failed to toggle skill:", err);
        }
      });

      const lbl = document.createElement("span");
      lbl.textContent = "Activa";
      toggleWrap.appendChild(chk);
      toggleWrap.appendChild(lbl);
      top.appendChild(toggleWrap);

      card.appendChild(top);

      if (skill.description) {
        const desc = document.createElement("p");
        desc.className = "skill-card-desc";
        desc.textContent = skill.description;
        card.appendChild(desc);
      }

      const bottom = document.createElement("div");
      bottom.className = "skill-card-bottom";

      const meta = document.createElement("span");
      meta.style.color = "var(--ec-text-muted)";
      meta.style.fontSize = "11px";
      meta.textContent = skill.file ? skill.file.split(/[/\\]/).pop() : "SKILL.md";
      bottom.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "skill-card-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "skill-action-btn";
      editBtn.textContent = "Ver / Editar";
      editBtn.addEventListener("click", () => {
        openSkillEditForm(skill);
      });
      actions.appendChild(editBtn);

      if (skill.scope !== "builtin") {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "skill-action-btn is-danger";
        delBtn.textContent = "Eliminar";
        delBtn.addEventListener("click", async () => {
          if (confirm(`¿Eliminar la habilidad "${skill.name}"?`)) {
            try {
              await window.editcoreSkills?.delete?.(skill.name);
              await refreshSkillsList();
            } catch (err) {
              alert("Error al eliminar habilidad: " + err.message);
            }
          }
        });
        actions.appendChild(delBtn);
      }

      bottom.appendChild(actions);
      card.appendChild(bottom);

      listEl.appendChild(card);
    }
  }

  function openSkillEditForm(skill) {
    const formCard = $("skillsNewFormCard");
    const title = $("skillsFormTitle");
    const nameInp = $("skillInputName");
    const catInp = $("skillInputCategory");
    const descInp = $("skillInputDesc");
    const contentInp = $("skillInputContent");
    if (!formCard) return;

    if (skill) {
      if (title) title.textContent = `Editar Habilidad: ${skill.name}`;
      if (nameInp) {
        nameInp.value = skill.name;
        nameInp.disabled = true;
      }
      if (catInp) catInp.value = skill.category || "";
      if (descInp) descInp.value = skill.description || "";
      if (contentInp) contentInp.value = skill.content || "";
    } else {
      if (title) title.textContent = "Nueva Habilidad";
      if (nameInp) {
        nameInp.value = "";
        nameInp.disabled = false;
      }
      if (catInp) catInp.value = "";
      if (descInp) descInp.value = "";
      if (contentInp) contentInp.value = "";
    }
    formCard.style.display = "flex";
  }

  function closeSkillEditForm() {
    const formCard = $("skillsNewFormCard");
    if (formCard) formCard.style.display = "none";
  }

  function openSkillsDialog() {
    const dlg = $("skillsDialog");
    if (!dlg) return;
    closeSkillEditForm();
    if (typeof dlg.showModal === "function") {
      try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
    } else {
      dlg.setAttribute("open", "");
    }
    refreshSkillsList();
  }

  function closeSkillsDialog() {
    const dlg = $("skillsDialog");
    if (!dlg) return;
    if (typeof dlg.close === "function") {
      try { dlg.close(); } catch { dlg.removeAttribute("open"); }
    } else {
      dlg.removeAttribute("open");
    }
  }

  function triggerMic() {
    const run = () => {
      if (typeof window.EditCoreDictation?.toggle === "function") {
        try {
          window.EditCoreDictation.toggle();
          return true;
        } catch (err) {
          console.warn("[chat-home] EditCoreDictation.toggle", err?.message || err);
        }
      }
      return false;
    };
    if (run()) return;
    // El bridge a veces llega un tick después del boot Chat.
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (run() || tries >= 8) {
        clearInterval(timer);
        if (tries >= 8 && typeof window.EditCoreDictation?.toggle !== "function") {
          const overlay = $("voiceOverlay");
          if (overlay && document.body.dataset.appMode === "chat" && overlay.parentElement !== document.body) {
            overlay._editcoreOrigParent = overlay.parentElement;
            document.body.appendChild(overlay);
          }
          const voice = $("voiceBtn");
          if (voice) {
            voice.style.pointerEvents = "auto";
            voice.click();
            return;
          }
          try { window.EditCoreVoiceMode?.toggle?.(); } catch { /* ignore */ }
          console.warn("[chat-home] Dictado no disponible todavía");
        }
      }
    }, 60);
  }

  const SIDEBAR_W_KEY = "editcore.chatHome.sidebarWidth";
  function applySidebarWidth(px) {
    const width = Math.max(180, Math.min(480, Math.round(Number(px) || 260)));
    const shell = $("chatHomeShell");
    if (shell) shell.style.setProperty("--ch-sidebar-width", `${width}px`);
    return width;
  }
  function loadSidebarWidth() {
    try {
      const raw = localStorage.getItem(SIDEBAR_W_KEY);
      if (raw) applySidebarWidth(raw);
    } catch { /* ignore */ }
  }
  function bindSidebarResize() {
    const split = $("chatHomeSidebarSplit");
    const sidebar = document.querySelector(".chat-home-sidebar");
    if (!split || !sidebar) return;
    let dragging = false;
    let startX = 0;
    let startW = 260;
    const onMove = (ev) => {
      if (!dragging) return;
      const dx = (ev.clientX || 0) - startX;
      applySidebarWidth(startW + dx);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      split.classList.remove("is-dragging");
      document.body.classList.remove("ch-resizing-sidebar");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        const w = getComputedStyle($("chatHomeShell") || document.documentElement)
          .getPropertyValue("--ch-sidebar-width")
          .trim()
          .replace("px", "");
        localStorage.setItem(SIDEBAR_W_KEY, String(Math.round(Number(w) || 260)));
      } catch { /* ignore */ }
    };
    split.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      dragging = true;
      startX = ev.clientX || 0;
      startW = sidebar.getBoundingClientRect().width || 260;
      split.classList.add("is-dragging");
      document.body.classList.add("ch-resizing-sidebar");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    split.addEventListener("keydown", (ev) => {
      const cur = sidebar.getBoundingClientRect().width || 260;
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        const w = applySidebarWidth(cur - 16);
        try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch { /* ignore */ }
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        const w = applySidebarWidth(cur + 16);
        try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch { /* ignore */ }
      }
    });
  }

  function formatTimeAgo(ts) {
    if (!ts) return "";
    const diffMs = Date.now() - Number(ts);
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "ahora";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
  }

  function getProjectsWithChats() {
    if (typeof window.getProjectsWithChats === "function") {
      try {
        const list = window.getProjectsWithChats();
        if (Array.isArray(list) && list.length) return list;
      } catch { /* ignore */ }
    }
    const projects = window.state?.projects || [];
    const currentProjId = window.state?.activeProjectId;
    if (projects.length) {
      return projects.map((p) => {
        const pName = p.title && p.title !== "Nuevo chat" && p.title !== "Proyecto"
          ? p.title 
          : (p.projectRoot ? p.projectRoot.split(/[\\/]/).filter(Boolean).pop() : (p.name && p.name !== "Proyecto" ? p.name : "Proyecto"));
        return {
          id: p.id,
          name: pName,
          projectRoot: p.projectRoot || "",
          isActive: p.id === currentProjId,
          chats: (p.chats || []).map((c) => ({
            id: c.id,
            title: c.title || "Conversación",
            updatedAt: c.updatedAt || c.createdAt || Date.now(),
            createdAt: c.createdAt || Date.now(),
            projectId: p.id,
            projectName: pName,
            projectRoot: p.projectRoot || "",
            messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
            isActive: c.id === p.activeChatId && p.id === currentProjId,
          })),
        };
      });
    }
    return [{
      id: "default",
      name: "Conversaciones",
      projectRoot: "",
      isActive: true,
      chats: store.threads.map((t) => ({
        ...t,
        projectId: "default",
        projectName: "Conversaciones",
        isActive: t.id === store.activeId,
      })),
    }];
  }

  function renderThreadList() {
    const list = $("chatHomeThreadList");
    if (!list) return;
    const q = String(store.search || "").trim().toLowerCase();
    list.replaceChildren();

    const allGroups = getProjectsWithChats();
    const activeId = getActiveThreadId();

    const folderProjects = allGroups.filter((p) => p.projectRoot || (p.name && p.name !== "Conversaciones" && p.name !== "Proyecto"));
    const standaloneChats = [];

    for (const g of allGroups) {
      if (!g.projectRoot && (!g.name || g.name === "Conversaciones" || g.name === "Proyecto")) {
        for (const c of g.chats) standaloneChats.push(c);
      }
    }
    for (const st of store.threads) {
      if (!standaloneChats.some((c) => c.id === st.id)) {
        standaloneChats.push({
          ...st,
          projectId: "default",
          projectName: "Conversaciones",
          isActive: st.id === activeId || st.id === store.activeId,
        });
      }
    }

    // 1. PROJECTS SECTION
    const projSectionLabel = document.createElement("div");
    projSectionLabel.className = "chat-home-section-label";
    projSectionLabel.textContent = "Projects";
    list.appendChild(projSectionLabel);

    if (!folderProjects.length) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "chat-home-thread-empty";
      emptyDiv.textContent = "No projects connected";
      list.appendChild(emptyDiv);
    } else {
      for (const proj of folderProjects) {
        const matchingChats = proj.chats.filter((t) => 
          !q || String(t.title || "").toLowerCase().includes(q) || String(proj.name || "").toLowerCase().includes(q)
        );

        if (q && !matchingChats.length && !String(proj.name || "").toLowerCase().includes(q)) {
          continue;
        }

        const group = document.createElement("div");
        group.className = `chat-home-project-group${proj.isActive ? " is-active-project" : ""}`;

        const head = document.createElement("div");
        head.className = "chat-home-project-group-head";
        head.title = proj.projectRoot ? `Proyecto: ${proj.projectRoot}` : `Proyecto: ${proj.name}`;
        
        const icon = document.createElement("span");
        icon.className = "chat-home-proj-icon";
        icon.replaceChildren(createSvgIcon("folder", 13));
        
        const name = document.createElement("span");
        name.className = "chat-home-proj-name";
        name.textContent = proj.name || "Proyecto";

        const projDel = document.createElement("button");
        projDel.type = "button";
        projDel.className = "chat-home-proj-del";
        projDel.title = "Quitar proyecto de la lista";
        projDel.textContent = "×";
        projDel.addEventListener("click", (ev) => {
          ev.stopPropagation();
          deleteProject(proj.id, proj.name);
        });

        head.appendChild(icon);
        head.appendChild(name);
        head.appendChild(projDel);
        head.addEventListener("click", () => {
          if (proj.id && proj.id !== window.state?.activeProjectId) {
            if (typeof window.selectProject === "function") {
              window.selectProject(proj.id);
            }
          }
        });
        group.appendChild(head);

        const ul = document.createElement("ul");
        ul.className = "chat-home-project-chats";

        if (!matchingChats.length) {
          const emptyLi = document.createElement("li");
          emptyLi.className = "chat-home-thread-empty";
          emptyLi.textContent = "No conversations yet";
          ul.appendChild(emptyLi);
        } else {
          for (const t of matchingChats) {
            const li = document.createElement("li");
            const isActive = t.id === activeId || (t.id === store.activeId && !activeId);
            li.className = `chat-home-thread${isActive ? " is-active" : ""}`;
            
            const title = document.createElement("div");
            title.className = "chat-home-thread-title";
            title.textContent = t.title || "Conversación";
            title.title = "Doble clic para renombrar";

            const meta = document.createElement("span");
            meta.className = "chat-home-thread-meta";
            meta.textContent = formatTimeAgo(t.updatedAt || t.createdAt);

            const del = document.createElement("button");
            del.type = "button";
            del.className = "chat-home-thread-del";
            del.title = "Eliminar";
            del.textContent = "×";
            del.addEventListener("click", (ev) => {
              ev.stopPropagation();
              deleteThread(t.id, proj.id);
            });

            li.appendChild(title);
            li.appendChild(meta);
            li.appendChild(del);

            li.addEventListener("click", () => selectThread(t.id, proj.id));
            title.addEventListener("dblclick", (ev) => {
              ev.stopPropagation();
              renameThread(t.id, proj.id);
            });

            ul.appendChild(li);
          }
        }

        group.appendChild(ul);
        list.appendChild(group);
      }
    }

    // 2. CONVERSATIONS SECTION (Global/Standalone)
    const convSectionLabel = document.createElement("div");
    convSectionLabel.className = "chat-home-section-label chat-home-section-with-add";
    
    const convTitle = document.createElement("span");
    convTitle.textContent = "Conversations";
    
    const convAddBtn = document.createElement("button");
    convAddBtn.type = "button";
    convAddBtn.className = "chat-home-section-add-btn";
    convAddBtn.title = "Nueva conversación";
    convAddBtn.textContent = "+";
    convAddBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      createThread();
    });

    convSectionLabel.appendChild(convTitle);
    convSectionLabel.appendChild(convAddBtn);
    list.appendChild(convSectionLabel);

    const matchingStandalone = standaloneChats.filter((t) =>
      !q || String(t.title || "").toLowerCase().includes(q)
    );

    const convUl = document.createElement("ul");
    convUl.className = "chat-home-project-chats chat-home-standalone-chats";

    if (!matchingStandalone.length) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "chat-home-thread-empty";
      emptyLi.textContent = "No conversations yet";
      convUl.appendChild(emptyLi);
    } else {
      for (const t of matchingStandalone) {
        const li = document.createElement("li");
        const isActive = t.id === activeId || (t.id === store.activeId && !activeId);
        li.className = `chat-home-thread${isActive ? " is-active" : ""}`;
        
        const title = document.createElement("div");
        title.className = "chat-home-thread-title";
        title.textContent = t.title || "Conversación";
        title.title = "Doble clic para renombrar";

        const meta = document.createElement("span");
        meta.className = "chat-home-thread-meta";
        meta.textContent = formatTimeAgo(t.updatedAt || t.createdAt);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "chat-home-thread-del";
        del.title = "Eliminar";
        del.textContent = "×";
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          deleteThread(t.id, t.projectId || "default");
        });

        li.appendChild(title);
        li.appendChild(meta);
        li.appendChild(del);

        li.addEventListener("click", () => selectThread(t.id, t.projectId || "default"));
        title.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          renameThread(t.id, t.projectId || "default");
        });

        convUl.appendChild(li);
      }
    }
    list.appendChild(convUl);

    syncCrumb();
  }

  async function selectThread(id, projectId) {
    store.activeId = id;
    saveStore(store);
    try {
      if (typeof window.switchChatThread === "function") {
        await window.switchChatThread(id, projectId);
      }
    } catch (err) {
      console.warn("[chat-home] selectThread", err);
    }
    renderThreadList();
    syncFolderChip();
    syncCrumb();
    syncEmptyState();
    try { window.EditCoreChatScroll?.toBottom?.(true); } catch { /* ignore */ }
    const promptEl = $("chatHomePrompt");
    promptEl?.focus();
  }

  function createThread() {
    let created = null;
    try {
      if (typeof window.createNewChatThread === "function") {
        created = window.createNewChatThread();
      }
    } catch (err) {
      console.warn("[chat-home] createThread", err);
    }
    const t = {
      id: created?.id || uid(),
      title: "Nueva conversación",
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    if (!created) {
      store.threads.unshift(t);
    }
    store.activeId = t.id;
    saveStore(store);
    const feed = $("feed");
    if (feed) feed.replaceChildren();
    renderThreadList();
    syncFolderChip();
    syncCrumb();
    syncEmptyState();
    $("chatHomePrompt")?.focus();
  }

  function showModalConfirm({
    title = "Confirmar",
    desc = "¿Deseas continuar?",
    confirmText = "Aceptar",
    cancelText = "Cancelar",
    isDanger = false,
    hasInput = false,
    inputValue = "",
    inputPlaceholder = "",
  } = {}) {
    return new Promise((resolve) => {
      const modal = $("chatHomeDialogModal");
      const titleEl = $("chatHomeModalTitle");
      const descEl = $("chatHomeModalDesc");
      const inputWrap = $("chatHomeModalInputWrap");
      const inputEl = $("chatHomeModalInput");
      const cancelBtn = $("chatHomeModalCancelBtn");
      const confirmBtn = $("chatHomeModalConfirmBtn");
      const closeBtn = $("chatHomeModalCloseBtn");

      if (!modal || !confirmBtn) {
        if (hasInput) {
          const res = window.prompt(desc || title, inputValue);
          resolve(res);
        } else {
          const res = window.confirm(desc || title);
          resolve(res);
        }
        return;
      }

      if (titleEl) titleEl.textContent = title;
      if (descEl) descEl.textContent = desc;
      if (cancelBtn) cancelBtn.textContent = cancelText;
      if (confirmBtn) {
        confirmBtn.textContent = confirmText;
        if (isDanger) confirmBtn.className = "chat-home-modal-btn chat-home-modal-btn-primary is-danger";
        else confirmBtn.className = "chat-home-modal-btn chat-home-modal-btn-primary";
      }

      if (hasInput && inputWrap && inputEl) {
        inputWrap.classList.remove("hidden");
        inputWrap.removeAttribute("hidden");
        inputEl.value = inputValue || "";
        inputEl.placeholder = inputPlaceholder || "";
      } else if (inputWrap) {
        inputWrap.classList.add("hidden");
        inputWrap.setAttribute("hidden", "");
      }

      modal.classList.remove("hidden");
      modal.removeAttribute("hidden");
      modal.setAttribute("aria-hidden", "false");

      const cleanup = () => {
        modal.classList.add("hidden");
        modal.setAttribute("hidden", "");
        modal.setAttribute("aria-hidden", "true");
        confirmBtn.removeEventListener("click", onConfirm);
        cancelBtn?.removeEventListener("click", onCancel);
        closeBtn?.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onOverlayClick);
        document.removeEventListener("keydown", onKeyDown);
      };

      const onConfirm = () => {
        const val = hasInput ? (inputEl?.value?.trim() ?? "") : true;
        cleanup();
        resolve(val);
      };

      const onCancel = () => {
        cleanup();
        resolve(hasInput ? null : false);
      };

      const onOverlayClick = (ev) => {
        if (ev.target === modal) onCancel();
      };

      const onKeyDown = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          onCancel();
        } else if (ev.key === "Enter" && hasInput) {
          ev.preventDefault();
          onConfirm();
        }
      };

      confirmBtn.addEventListener("click", onConfirm);
      cancelBtn?.addEventListener("click", onCancel);
      closeBtn?.addEventListener("click", onCancel);
      modal.addEventListener("click", onOverlayClick);
      document.addEventListener("keydown", onKeyDown);

      if (hasInput && inputEl) {
        setTimeout(() => {
          inputEl.focus();
          inputEl.select();
        }, 50);
      } else {
        setTimeout(() => confirmBtn.focus(), 50);
      }
    });
  }

  async function renameThread(id, projectId) {
    let currentTitle = "";
    const projects = getProjectsWithChats();
    for (const p of projects) {
      const found = p.chats.find((c) => c.id === id);
      if (found) {
        currentTitle = found.title;
        break;
      }
    }
    if (!currentTitle) {
      const thread = getThreads().find((x) => x.id === id);
      currentTitle = thread?.title || "Conversación";
    }

    const next = await showModalConfirm({
      title: "Renombrar conversación",
      desc: "Ingresa el nuevo nombre para este chat:",
      confirmText: "Guardar",
      cancelText: "Cancelar",
      hasInput: true,
      inputValue: currentTitle,
      inputPlaceholder: "Nombre del chat...",
    });
    if (next == null) return;
    const clean = String(next).trim() || currentTitle;

    try {
      if (typeof window.renameChatThread === "function") {
        window.renameChatThread(id, clean, projectId);
      }
    } catch (err) {
      console.warn("[chat-home] renameThread", err);
    }
    const t = store.threads.find((x) => x.id === id);
    if (t) {
      t.title = clean;
      t.updatedAt = Date.now();
      saveStore(store);
    }
    renderThreadList();
    syncCrumb();
  }

  async function deleteThread(id, projectId) {
    const confirmed = await showModalConfirm({
      title: "Eliminar conversación",
      desc: "¿Estás seguro de que deseas eliminar este chat? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      isDanger: true,
    });
    if (!confirmed) return;

    try {
      if (typeof window.closeChatThread === "function") {
        window.closeChatThread(id, projectId);
      }
    } catch (err) {
      console.warn("[chat-home] deleteThread", err);
    }
    store.threads = store.threads.filter((t) => t.id !== id);
    if (store.activeId === id) {
      const activeFromWindow = getActiveThreadId();
      store.activeId = activeFromWindow && activeFromWindow !== id ? activeFromWindow : (store.threads[0]?.id || "");
    }
    saveStore(store);
    renderThreadList();
    syncCrumb();
    syncFolderChip();
    syncEmptyState();
  }

  async function deleteProject(projectId, projectName) {
    const confirmed = await showModalConfirm({
      title: "Quitar proyecto",
      desc: `¿Deseas quitar el proyecto "${projectName || "Proyecto"}" de la lista? Tus archivos en disco no se borrarán.`,
      confirmText: "Quitar",
      cancelText: "Cancelar",
      isDanger: true,
    });
    if (!confirmed) return;

    try {
      if (typeof window.removeProject === "function") {
        window.removeProject(projectId);
      }
    } catch (err) {
      console.warn("[chat-home] deleteProject", err);
    }
    renderThreadList();
    syncFolderChip();
    syncCrumb();
    syncEmptyState();
  }

  function touchActiveFromPrompt(text) {
    const t = ensureThread();
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean && (!t.title || t.title === "Nueva conversación" || t.title === "Nuevo chat" || /^Chat\s+\d+$/i.test(t.title))) {
      t.title = clean.slice(0, 48);
      try {
        if (typeof window.renameChatThread === "function") {
          window.renameChatThread(t.id, t.title);
        }
      } catch { /* ignore */ }
    }
    t.updatedAt = Date.now();
    saveStore(store);
    renderThreadList();
  }

  async function connectFolder() {
    try {
      if (typeof window.openProjectFromDisk === "function") {
        await window.openProjectFromDisk();
      } else if ($("welcomeOpenBtn")) {
        $("welcomeOpenBtn").click();
      }
    } catch (error) {
      console.warn("[chat-home] connectFolder", error?.message || error);
    }
    syncFolderChip();
  }

  function submitHomePrompt() {
    const homePrompt = $("chatHomePrompt");
    const idePrompt = $("prompt");
    const text = String(homePrompt?.value || idePrompt?.value || "").trim();
    const hasAttachments = Boolean(window.EditCoreAttachments?.list?.()?.length);
    if (!text && !hasAttachments) return;
    touchActiveFromPrompt(text || "Adjunto");
    if (homePrompt) homePrompt.value = "";
    if (idePrompt) idePrompt.value = "";

    if (typeof window.sendChatPrompt === "function") {
      window.sendChatPrompt(text);
    } else if (typeof window.triggerChatSend === "function") {
      window.triggerChatSend(text);
    } else {
      if (idePrompt) {
        idePrompt.value = text;
        idePrompt.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const form = $("chatForm");
      if (form && typeof form.requestSubmit === "function") form.requestSubmit();
      else $("sendBtn")?.click();
    }
    setTimeout(syncEmptyState, 80);
    setTimeout(syncEmptyState, 400);
    // El feed en Chat scrollea en #chatHomeFeedHost; forzar baja tras enviar.
    const bump = () => {
      try { window.EditCoreChatScroll?.toBottom?.(true); } catch { /* ignore */ }
      const host = $("chatHomeFeedHost");
      const feed = $("feed");
      if (host) host.scrollTop = host.scrollHeight;
      if (feed?.lastElementChild) {
        try { feed.lastElementChild.scrollIntoView({ block: "end", behavior: "auto" }); } catch { /* ignore */ }
      }
    };
    setTimeout(bump, 30);
    setTimeout(bump, 120);
    setTimeout(bump, 320);
  }

  const SLASH_COMMANDS = [
    { key: "/test", icon: "test", title: "/test", desc: "Generar y ejecutar pruebas automáticas", prompt: "Por favor, analiza el código del proyecto y genera un conjunto completo de pruebas unitarias y de integración. Luego, ejecútalas para verificar su funcionamiento." },
    { key: "/commit", icon: "commit", title: "/commit", desc: "Generar mensaje de commit convencional", prompt: "Revisa el estado de git (archivos modificados y diffs) y genera un mensaje de commit convencional y descriptivo siguiendo las mejores prácticas." },
    { key: "/explain", icon: "explain", title: "/explain", desc: "Explicar arquitectura y funcionamiento", prompt: "Por favor, explica en detalle cómo funciona este componente o proyecto, su flujo de datos, arquitectura y puntos clave." },
    { key: "/refactor", icon: "refactor", title: "/refactor", desc: "Refactorizar y optimizar código", prompt: "Por favor, refactoriza este código mejorando su estructura, legibilidad y rendimiento sin modificar su comportamiento externo." },
    { key: "/fix", icon: "fix", title: "/fix", desc: "Diagnosticar y reparar un error o bug", prompt: "Tengo un error en el proyecto. Por favor, diagnostica la causa raíz y aplica la solución necesaria para repararlo." },
    { key: "/audit", icon: "audit", title: "/audit", desc: "Auditar seguridad y dependencias", prompt: "Realiza una auditoría completa de seguridad, dependencias obsoletas y validación de variables de entorno en este proyecto." },
    { key: "/db", icon: "db", title: "/db", desc: "Diseñar esquemas SQL y migraciones", prompt: "Diseña o actualiza el esquema de la base de datos para este proyecto y genera las migraciones SQL correspondientes." },
  ];

  const MENTION_TYPES = [
    { key: "@Git", icon: "git", title: "@Git", desc: "Adjuntar estado y diffs actuales de Git", token: "[Contexto: Git Status y Diff actual]" },
    { key: "@Docs", icon: "docs", title: "@Docs", desc: "Consultar documentación técnica y guías", token: "[Contexto: Documentación del proyecto]" },
    { key: "@Web", icon: "web", title: "@Web", desc: "Consultar recursos web o URL", token: "[Contexto: Búsqueda Web]" },
    { key: "@Archivos", icon: "folder", title: "@Archivos", desc: "Explorar y adjuntar archivos del proyecto", token: "[Contexto: Archivos del proyecto]" },
  ];

  function getProjectFileList() {
    const list = [];
    const projects = window.state?.projects || [];
    for (const p of projects) {
      if (Array.isArray(p.files)) {
        for (const f of p.files) {
          const path = typeof f === "string" ? f : (f.path || f.name || "");
          const name = path.split(/[\\/]/).pop() || path;
          if (name) list.push({ name, path });
        }
      }
    }
    const tree = window.state?.treeEntries || [];
    for (const t of tree) {
      if (t.name && !t.isDirectory) {
        list.push({ name: t.name, path: t.path || t.name });
      }
    }
    const rootName = window.state?.projectRoot?.split(/[\\/]/).pop();
    if (rootName) {
      list.unshift({ name: "package.json", path: "package.json" });
      list.unshift({ name: "README.md", path: "README.md" });
    }
    const seen = new Set();
    return list.filter((item) => {
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }

  function setupAutocomplete(inputEl, parentEl) {
    if (!inputEl || !parentEl) return;
    let popup = parentEl.querySelector(".ec-mention-popup");
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "ec-mention-popup hidden";
      popup.hidden = true;
      parentEl.appendChild(popup);
    }

    let activeIndex = 0;
    let currentItems = [];
    let currentTrigger = null; // "@" or "/"

    function hide() {
      popup.classList.add("hidden");
      popup.hidden = true;
      popup.replaceChildren();
      currentItems = [];
      currentTrigger = null;
      activeIndex = 0;
    }

    function renderItems() {
      popup.replaceChildren();
      if (!currentItems.length) {
        hide();
        return;
      }

      const head = document.createElement("div");
      head.className = "ec-mention-header";
      head.textContent = currentTrigger === "/" ? "Comandos rápidos (Slash)" : "Menciones de Contexto";
      popup.appendChild(head);

      currentItems.forEach((item, idx) => {
        const row = document.createElement("div");
        row.className = `ec-mention-item${idx === activeIndex ? " is-selected" : ""}`;

        const icon = document.createElement("span");
        icon.className = "ec-mention-icon";
        if (typeof item.icon === "string" && SVG_ICONS[item.icon]) {
          icon.replaceChildren(createSvgIcon(item.icon, 14));
        } else {
          icon.replaceChildren(createSvgIcon("sparkle", 14));
        }

        const info = document.createElement("div");
        info.className = "ec-mention-info";

        const title = document.createElement("span");
        title.className = "ec-mention-title";
        title.textContent = item.title;

        const desc = document.createElement("span");
        desc.className = "ec-mention-desc";
        desc.textContent = item.desc || "";

        info.appendChild(title);
        info.appendChild(desc);

        row.appendChild(icon);
        row.appendChild(info);

        row.addEventListener("mouseenter", () => {
          activeIndex = idx;
          updateSelection();
        });

        row.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          selectItem(item);
        });

        popup.appendChild(row);
      });

      popup.classList.remove("hidden");
      popup.hidden = false;
      updateSelection();
    }

    function updateSelection() {
      const rows = popup.querySelectorAll(".ec-mention-item");
      rows.forEach((r, idx) => {
        if (idx === activeIndex) {
          r.classList.add("is-selected");
          try { r.scrollIntoView({ block: "nearest" }); } catch {}
        } else {
          r.classList.remove("is-selected");
        }
      });
    }

    function selectItem(item) {
      const val = inputEl.value;
      const cursor = inputEl.selectionStart || val.length;
      const before = val.slice(0, cursor);
      const after = val.slice(cursor);

      if (currentTrigger === "/") {
        inputEl.value = item.prompt ? item.prompt + (after ? " " + after : "") : item.title + " " + after;
      } else if (currentTrigger === "@") {
        const lastAt = before.lastIndexOf("@");
        const prefix = before.slice(0, lastAt);
        inputEl.value = prefix + (item.token || item.title) + " " + after;
      }
      hide();
      inputEl.focus();
      const nextPos = inputEl.value.length;
      inputEl.setSelectionRange(nextPos, nextPos);
    }

    inputEl.addEventListener("input", () => {
      const val = inputEl.value;
      const cursor = inputEl.selectionStart || val.length;
      const before = val.slice(0, cursor);

      // Check slash commands (at start or preceded by newline)
      const slashMatch = before.match(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/);
      if (slashMatch) {
        currentTrigger = "/";
        const q = slashMatch[1].toLowerCase();
        currentItems = SLASH_COMMANDS.filter((c) => c.key.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
        activeIndex = 0;
        renderItems();
        return;
      }

      // Check @ mentions (including files from project)
      const atMatch = before.match(/@([a-zA-Z0-9_\-\./]*)$/);
      if (atMatch) {
        currentTrigger = "@";
        const q = atMatch[1].toLowerCase();
        const baseItems = MENTION_TYPES.filter((m) => m.key.toLowerCase().includes(q) || m.title.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q));
        const fileList = getProjectFileList();
        const fileMatches = fileList
          .filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
          .slice(0, 15)
          .map((f) => ({
            key: `@${f.name}`,
            icon: "file",
            title: `@${f.name}`,
            desc: f.path || f.name,
            token: `[Archivo: ${f.path || f.name}]`,
          }));
        currentItems = [...baseItems, ...fileMatches];
        activeIndex = 0;
        renderItems();
        return;
      }

      hide();
    });

    inputEl.addEventListener("keydown", (ev) => {
      if (!popup.hidden && currentItems.length > 0) {
        if (ev.key === "ArrowDown") {
          ev.preventDefault();
          activeIndex = (activeIndex + 1) % currentItems.length;
          updateSelection();
        } else if (ev.key === "ArrowUp") {
          ev.preventDefault();
          activeIndex = (activeIndex - 1 + currentItems.length) % currentItems.length;
          updateSelection();
        } else if (ev.key === "Enter" || ev.key === "Tab") {
          if (!ev.shiftKey && currentItems[activeIndex]) {
            ev.preventDefault();
            selectItem(currentItems[activeIndex]);
          }
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          hide();
        }
      }
    });

    document.addEventListener("click", (ev) => {
      if (!popup.contains(ev.target) && ev.target !== inputEl) {
        hide();
      }
    });

    return { hide };
  }

  function bind() {
    ensureThread();
    loadSidebarWidth();
    bindSidebarResize();
    initContextPanelState();
    const homePromptEl = $("chatHomePrompt");
    const homeComposerEl = $("chatHomeComposer") || homePromptEl?.parentElement;
    if (homePromptEl && homeComposerEl) {
      setupAutocomplete(homePromptEl, homeComposerEl);
    }
    $("chatHomeIdeBtn")?.addEventListener("click", () => setMode("ide"));
    $("openChatHomeBtn")?.addEventListener("click", () => setMode("chat"));
    $("chatHomeNewBtn")?.addEventListener("click", () => createThread());
    $("chatHomeNavChats")?.addEventListener("click", () => {
      const search = $("chatHomeSearch");
      if (search) search.value = "";
      store.search = "";
      renderThreadList();
      syncEmptyState();
    });
    $("chatHomeFolderBtn")?.addEventListener("click", () => void connectFolder());
    $("chatHomeNavFolder")?.addEventListener("click", () => void connectFolder());
    $("chatHomePlusBtn")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.EditCoreAttachments?.openPicker === "function") {
        window.EditCoreAttachments.openPicker();
        return;
      }
      $("fileInput")?.click();
    });
    $("chatHomeModelPill")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openModelPicker();
    });
    $("chatHomeMicBtn")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      triggerMic();
    });
    $("chatHomeSettingsBtn")?.addEventListener("click", () => openSettings());
    $("chatHomeContextBtn")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      selectContextTab("session");
    });
    $("chatHomeContextDock")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setContextPanelOpen(true);
    });
    document.querySelectorAll("[data-ctx-tab]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selectContextTab(btn.getAttribute("data-ctx-tab"));
      });
    });
    $("chatHomeContextClose")?.addEventListener("click", () => setContextPanelOpen(false));
    $("chatHomeSettingsClose")?.addEventListener("click", () => closeSettings());
    $("chatHomeSettingsSheet")?.addEventListener("click", (ev) => {
      if (ev.target === $("chatHomeSettingsSheet")) closeSettings();
    });
    document.querySelectorAll("[data-ch-setting]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runSetting(btn.getAttribute("data-ch-setting"));
      });
    });
    document.querySelectorAll("[data-ch-theme]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        applyThemeFromSettings(btn.getAttribute("data-ch-theme"));
      });
    });
    document.querySelectorAll("[data-ch-perm]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        applyPermFromSettings(btn.getAttribute("data-ch-perm"));
      });
    });
    document.querySelectorAll("[data-ch-settings-back]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showSettingsPanel("main");
      });
    });
    $("closeSkillsBtn")?.addEventListener("click", () => closeSkillsDialog());
    $("skillsCloseBottomBtn")?.addEventListener("click", () => closeSkillsDialog());
    $("skillsSearchInput")?.addEventListener("input", () => renderSkillsModalList());
    $("skillsNewBtn")?.addEventListener("click", () => openSkillEditForm(null));
    $("skillsCancelFormBtn")?.addEventListener("click", () => closeSkillEditForm());
    $("skillsSaveBtn")?.addEventListener("click", async () => {
      const name = $("skillInputName")?.value.trim();
      const category = $("skillInputCategory")?.value.trim();
      const description = $("skillInputDesc")?.value.trim();
      const content = $("skillInputContent")?.value.trim();
      if (!name) {
        alert("Ingresa un identificador para la habilidad (ej. mi-habilidad)");
        return;
      }
      try {
        await window.editcoreSkills?.save?.({ name, category, description, content });
        closeSkillEditForm();
        await refreshSkillsList();
      } catch (err) {
        alert("Error al guardar la habilidad: " + err.message);
      }
    });
    $("skillsDialog")?.addEventListener("click", (ev) => {
      if (ev.target === $("skillsDialog")) closeSkillsDialog();
    });
    $("chatHomeSearch")?.addEventListener("input", (ev) => {
      store.search = String(ev.target?.value || "");
      renderThreadList();
    });
    $("chatHomeComposer")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      submitHomePrompt();
    });
    $("chatHomeSendBtn")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      submitHomePrompt();
    });
    $("chatHomePrompt")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        submitHomePrompt();
      }
    });

    const feed = $("feed");
    if (feed && typeof MutationObserver !== "undefined") {
      let emptyTimer = 0;
      const mo = new MutationObserver(() => {
        if (emptyTimer) return;
        emptyTimer = requestAnimationFrame(() => {
          emptyTimer = 0;
          syncEmptyState();
        });
      });
      mo.observe(feed, { childList: true });
    }
    const modelLabel = $("modelPickerLabel");
    if (modelLabel && typeof MutationObserver !== "undefined") {
      let pillTimer = 0;
      const mo2 = new MutationObserver(() => {
        if (pillTimer) return;
        pillTimer = requestAnimationFrame(() => {
          pillTimer = 0;
          syncModelPill();
        });
      });
      mo2.observe(modelLabel, { childList: true, characterData: true, subtree: true });
    }

    window.addEventListener("editcore:chats-updated", () => {
      renderThreadList();
      syncCrumb();
      syncFolderChip();
      syncEmptyState();
    });
    window.addEventListener("editcore:project-updated", () => {
      renderThreadList();
      syncCrumb();
      syncFolderChip();
      syncEmptyState();
    });

    window.addEventListener("keydown", (ev) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isMod = isMac ? ev.metaKey : ev.ctrlKey;
      const code = ev.code || "";
      const key = (ev.key || "").toLowerCase();

      // Escape -> Cerrar cualquier popup, diálogo o menú
      if (key === "escape" || code === "Escape") {
        closeSettings();
        closeSkillsDialog();
        const modal = $("chatHomeDialogModal");
        if (modal && !modal.hidden) {
          modal.classList.add("hidden");
          modal.hidden = true;
          modal.setAttribute("aria-hidden", "true");
        }
        document.querySelectorAll(".ec-mention-popup").forEach((p) => {
          p.classList.add("hidden");
          p.hidden = true;
        });
        return;
      }

      if (!isMod) return;

      // Ctrl + L -> Cambiar a Chat y enfocar prompt
      if (code === "KeyL" || key === "l") {
        ev.preventDefault();
        ev.stopPropagation();
        setMode("chat");
        setTimeout(() => {
          const promptEl = $("chatHomePrompt") || $("prompt");
          promptEl?.focus();
        }, 30);
        return;
      }

      // Ctrl + K -> Enfocar y seleccionar cajón de texto
      if (code === "KeyK" || key === "k") {
        ev.preventDefault();
        ev.stopPropagation();
        const isChat = document.body.dataset.appMode === "chat";
        const promptEl = isChat ? $("chatHomePrompt") : ($("prompt") || $("chatHomePrompt"));
        if (promptEl) {
          promptEl.focus();
          promptEl.select();
        }
        return;
      }

      // Ctrl + ` o Ctrl + ~ -> Conmutar Terminal en IDE
      if (code === "Backquote" || key === "`" || key === "~") {
        ev.preventDefault();
        ev.stopPropagation();
        if (document.body.dataset.appMode === "chat") {
          setMode("ide");
        }
        setTimeout(() => {
          try {
            if (typeof window.EditCoreTerminal?.show === "function") {
              window.EditCoreTerminal.show();
            }
          } catch {}
        }, 30);
        return;
      }

      // Ctrl + N -> Nuevo Chat
      if ((code === "KeyN" || key === "n") && !ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        createThread();
        return;
      }
    }, { capture: true });

    window.EditCoreChatHome = {
      setMode,
      getMode: () => document.body.dataset.appMode || "chat",
      refresh: () => {
        syncFolderChip();
        syncModelPill();
        renderThreadList();
        syncEmptyState();
        if (!$("chatHomeContextPanel")?.hidden) void refreshContextPanel();
      },
      connectFolder,
      openModelPicker,
      openSettings,
      openSkills: openSkillsDialog,
      refreshSkills: refreshSkillsList,
      toggleContextPanel,
      setContextPanelOpen,
      refreshContextPanel,
    };
  }

  function bootMode() {
    let preferred = "chat";
    try {
      const q = new URLSearchParams(location.search || "");
      if (q.get("mode") === "ide") preferred = "ide";
      else if (q.get("mode") === "chat") preferred = "chat";
      else if (!localStorage.getItem(MODE_KEY)) preferred = "chat";
      else if (localStorage.getItem(MODE_KEY) === "ide") preferred = "ide";
    } catch {
      preferred = "chat";
    }
    setMode(preferred === "ide" ? "ide" : "chat");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { bind(); bootMode(); }, { once: true });
  } else {
    bind();
    bootMode();
  }
})();
