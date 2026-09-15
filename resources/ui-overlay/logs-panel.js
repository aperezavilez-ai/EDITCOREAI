// ════════════════════════════════════════════════════════════════════
// PANEL DE LOGS — docked en el navegador (ancho del viewer)
// ════════════════════════════════════════════════════════════════════

(function initLogsPanel() {
  const logsPanel = document.getElementById("logsPanel");
  const logsOutput = document.getElementById("logs-output");
  const logsSplit = document.getElementById("splitPreviewLogs");
  const viewer = document.querySelector(".viewer");

  if (!logsPanel || !logsOutput) {
    console.warn("Panel de logs no encontrado en el DOM");
    return;
  }

  function setLogsOpen(open) {
    const next = open === true;
    logsPanel.classList.toggle("collapsed", !next);
    logsPanel.hidden = !next;
    logsPanel.setAttribute("aria-hidden", next ? "false" : "true");
    if (logsSplit) {
      logsSplit.classList.toggle("collapsed", !next);
      logsSplit.hidden = !next;
    }
    viewer?.classList.toggle("has-logs", next);
    if (next && viewer && !viewer.style.getPropertyValue("--viewer-logs-height")) {
      viewer.style.setProperty("--viewer-logs-height", "220px");
    }
    try {
      if (typeof schedulePreviewFit === "function") schedulePreviewFit();
    } catch {
      /* ignore */
    }
  }

  function isLogsOpen() {
    return !logsPanel.classList.contains("collapsed") && !logsPanel.hidden;
  }

  function toggleLogs() {
    setLogsOpen(!isLogsOpen());
  }

  // Drag resize (igual que terminal)
  if (logsSplit && viewer) {
    let dragging = false;
    logsSplit.addEventListener("mousedown", (e) => {
      if (logsSplit.hidden) return;
      dragging = true;
      e.preventDefault();
      document.body.style.cursor = "ns-resize";
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const rect = viewer.getBoundingClientRect();
      const fromBottom = rect.bottom - e.clientY;
      const clamped = Math.max(120, Math.min(Math.floor(rect.height * 0.55), fromBottom));
      viewer.style.setProperty("--viewer-logs-height", `${clamped}px`);
      try {
        if (typeof schedulePreviewFit === "function") schedulePreviewFit();
      } catch {
        /* ignore */
      }
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = "";
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "`") {
      e.preventDefault();
      toggleLogs();
    }
  });

  const logsBtn = document.getElementById("logsBtn");
  if (logsBtn) {
    logsBtn.addEventListener("click", () => {
      try {
        if (typeof closeAllToolbarMenus === "function") closeAllToolbarMenus();
      } catch {
        /* ignore */
      }
      toggleLogs();
    });
  }

  document.querySelector(".logs-btn-close")?.addEventListener("click", () => setLogsOpen(false));
  document.querySelector(".logs-btn-minimize")?.addEventListener("click", () => setLogsOpen(false));

  document.querySelectorAll(".logs-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".logs-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const level = btn.dataset.level;
      document.querySelectorAll(".log-entry").forEach((entry) => {
        entry.style.display = level === "all" || entry.classList.contains(level) ? "flex" : "none";
      });
    });
  });

  document.querySelector(".logs-btn-clear")?.addEventListener("click", () => {
    logsOutput.innerHTML = "";
    appendLog("info", "Logs limpiados");
  });

  function appendLog(level, message) {
    const entry = document.createElement("div");
    entry.className = `log-entry ${level}`;
    const timestamp = new Date().toLocaleTimeString("es-ES", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    entry.innerHTML = `
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-message">${escapeHtml(String(message))}</span>
    `;
    logsOutput.appendChild(entry);
    logsOutput.scrollTop = logsOutput.scrollHeight;
    if (level === "error" && !isLogsOpen()) setLogsOpen(true);
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = function (...args) {
    const message = args.map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(" ");
    appendLog("info", message);
    originalLog.apply(console, args);
  };

  console.warn = function (...args) {
    const message = args.map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(" ");
    appendLog("warn", message);
    originalWarn.apply(console, args);
  };

  console.error = function (...args) {
    const message = args.map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(" ");
    appendLog("error", message);
    originalError.apply(console, args);
  };

  window.addLog = appendLog;
  window.setLogsOpen = setLogsOpen;

  // Empieza cerrado dentro del viewer
  setLogsOpen(false);
  appendLog("info", "Panel de logs listo — Ctrl+` para abrir/cerrar (ancho del navegador)");
})();
