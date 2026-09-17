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

  function uid() {
    return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function ensureThread() {
    if (!store.threads.length) {
      const t = {
        id: uid(),
        title: "Nueva conversación",
        updatedAt: Date.now(),
        createdAt: Date.now(),
      };
      store.threads.unshift(t);
      store.activeId = t.id;
      saveStore(store);
    }
    if (!store.activeId || !store.threads.some((t) => t.id === store.activeId)) {
      store.activeId = store.threads[0].id;
      saveStore(store);
    }
    return store.threads.find((t) => t.id === store.activeId) || store.threads[0];
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
      renderThreadList();
      syncEmptyState();
      closeSettings();
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
    if (!panel) return;
    const next = open === true;
    panel.hidden = !next;
    panel.setAttribute("aria-hidden", next ? "false" : "true");
    btn?.classList.toggle("is-open", next);
    btn?.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) void refreshContextPanel();
  }

  function toggleContextPanel() {
    const panel = $("chatHomeContextPanel");
    setContextPanelOpen(Boolean(panel?.hidden));
  }

  function syncFolderChip() {
    const chip = $("chatHomeFolderChip");
    if (!chip) return;
    const root = String(window.state?.projectRoot || "").trim();
    if (root) {
      chip.classList.add("is-on");
      const name = root.split(/[\\/]/).filter(Boolean).pop() || root;
      chip.textContent = name;
      chip.title = root;
    } else {
      chip.classList.remove("is-on");
      chip.textContent = "";
    }
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
    // Preferir API de dictado (escribe en chatHomePrompt en modo Chat).
    if (typeof window.EditCoreDictation?.toggle === "function") {
      window.EditCoreDictation.toggle();
      return;
    }
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
  }

  function renderThreadList() {
    const list = $("chatHomeThreadList");
    if (!list) return;
    const q = String(store.search || "").trim().toLowerCase();
    list.replaceChildren();
    const threads = store.threads.filter((t) => !q || String(t.title || "").toLowerCase().includes(q));
    for (const t of threads) {
      const li = document.createElement("li");
      li.className = `chat-home-thread${t.id === store.activeId ? " is-active" : ""}`;
      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "chat-home-thread-title";
      title.textContent = t.title || "Conversación";
      title.title = "Doble clic para renombrar";
      const meta = document.createElement("div");
      meta.className = "chat-home-thread-meta";
      meta.textContent = new Date(t.updatedAt || t.createdAt || Date.now()).toLocaleString();
      left.appendChild(title);
      left.appendChild(meta);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "chat-home-thread-del";
      del.title = "Eliminar";
      del.textContent = "×";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deleteThread(t.id);
      });
      li.appendChild(left);
      li.appendChild(del);
      li.addEventListener("click", () => selectThread(t.id));
      title.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        renameThread(t.id);
      });
      list.appendChild(li);
    }
  }

  function selectThread(id) {
    store.activeId = id;
    saveStore(store);
    renderThreadList();
    syncEmptyState();
  }

  function createThread() {
    const t = {
      id: uid(),
      title: "Nueva conversación",
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    store.threads.unshift(t);
    store.activeId = t.id;
    saveStore(store);
    renderThreadList();
    try {
      if (typeof window.createNewChatThread === "function") window.createNewChatThread();
    } catch { /* ignore */ }
    const feed = $("feed");
    if (feed) feed.replaceChildren();
    syncEmptyState();
    $("chatHomePrompt")?.focus();
  }

  function renameThread(id) {
    const t = store.threads.find((x) => x.id === id);
    if (!t) return;
    const next = window.prompt("Nombre de la conversación", t.title || "");
    if (next == null) return;
    t.title = String(next).trim() || t.title;
    t.updatedAt = Date.now();
    saveStore(store);
    renderThreadList();
  }

  function deleteThread(id) {
    if (!window.confirm("¿Eliminar esta conversación?")) return;
    store.threads = store.threads.filter((t) => t.id !== id);
    if (!store.threads.length) ensureThread();
    else if (store.activeId === id) store.activeId = store.threads[0].id;
    saveStore(store);
    renderThreadList();
    syncEmptyState();
  }

  function touchActiveFromPrompt(text) {
    const t = ensureThread();
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean && (!t.title || t.title === "Nueva conversación")) {
      t.title = clean.slice(0, 48);
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
    const text = String(homePrompt?.value || "").trim();
    if (!text) return;
    touchActiveFromPrompt(text);
    if (idePrompt) {
      idePrompt.value = text;
      idePrompt.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (homePrompt) homePrompt.value = "";
    const form = $("chatForm");
    if (form && typeof form.requestSubmit === "function") form.requestSubmit();
    else $("sendBtn")?.click();
    setTimeout(syncEmptyState, 80);
    setTimeout(syncEmptyState, 400);
  }

  function bind() {
    ensureThread();
    $("chatHomeIdeBtn")?.addEventListener("click", () => setMode("ide"));
    $("openChatHomeBtn")?.addEventListener("click", () => setMode("chat"));
    $("chatHomeNewBtn")?.addEventListener("click", () => createThread());
    $("chatHomeFolderBtn")?.addEventListener("click", () => void connectFolder());
    $("chatHomeNavFolder")?.addEventListener("click", () => void connectFolder());
    $("chatHomePlusBtn")?.addEventListener("click", () => void connectFolder());
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
    $("chatHomeSettingsTopBtn")?.addEventListener("click", () => openSettings());
    $("chatHomeContextBtn")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleContextPanel();
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
      submitHomePrompt();
    });
    $("chatHomePrompt")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
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
