"use strict";

/**
 * Interactive terminal pane (xterm.js + editcorePty / node-pty|spawn-pipe).
 */
(function initEditCoreTerminal(global) {
  let term = null;
  let fitAddon = null;
  let sessionId = "";
  let unsubData = null;
  let booted = false;

  function panelEl() {
    return document.getElementById("terminalPanel");
  }

  function hostEl() {
    return document.getElementById("xtermHost");
  }

  function statusEl() {
    return document.getElementById("terminalBackendLabel");
  }

  async function loadXterm() {
    if (global.Terminal && (global.FitAddon?.FitAddon || global.FitAddon)) return;
    const xtermBase = global.editcoreIdeAssets?.xtermBase?.() || "./node_modules/xterm";
    const fitBase = global.editcoreIdeAssets?.xtermFitBase?.() || "./node_modules/xterm-addon-fit";
    await new Promise((resolve, reject) => {
      const cssId = "xterm-css";
      if (!document.getElementById(cssId)) {
        const link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href = `${xtermBase}/css/xterm.css`;
        document.head.appendChild(link);
      }
      const s1 = document.createElement("script");
      s1.src = `${xtermBase}/lib/xterm.js`;
      s1.onload = () => {
        const s2 = document.createElement("script");
        s2.src = `${fitBase}/lib/xterm-addon-fit.js`;
        s2.onload = resolve;
        s2.onerror = () => reject(new Error("xterm-addon-fit load failed"));
        document.head.appendChild(s2);
      };
      s1.onerror = () => reject(new Error("xterm load failed"));
      document.head.appendChild(s1);
    });
  }

  async function ensureTerminal() {
    if (term) return term;
    await loadXterm();
    const host = hostEl();
    if (!host) throw new Error("Falta #xtermHost");
    const Terminal = global.Terminal;
    const FitAddon = global.FitAddon?.FitAddon || global.FitAddon;
    term = new Terminal({
      convertEol: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: {
        background: "#0b1220",
        foreground: "#e2e8f0",
        cursor: "#93c5fd",
        selectionBackground: "#1e3a5f",
      },
      cursorBlink: true,
      scrollback: 4000,
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    try { fitAddon.fit(); } catch { /* ignore */ }
    term.onData((data) => {
      if (!sessionId || !window.editcorePty?.write) return;
      window.editcorePty.write({ id: sessionId, data }).catch(() => undefined);
    });
    return term;
  }

  async function start(cwd = "") {
    if (!window.editcorePty?.create) throw new Error("editcorePty no disponible.");
    await ensureTerminal();
    if (unsubData) {
      try { unsubData(); } catch { /* ignore */ }
      unsubData = null;
    }
    if (sessionId) {
      try { await window.editcorePty.kill({ id: sessionId }); } catch { /* ignore */ }
    }
    const cols = term.cols || 120;
    const rows = term.rows || 30;
    const snap = await window.editcorePty.create({
      cwd: cwd || (window.state?.projectRoot || ""),
      cols,
      rows,
    });
    sessionId = String(snap?.id || "");
    if (statusEl()) {
      statusEl().textContent = snap?.backend === "node-pty" ? "PTY" : "pipe";
      statusEl().title = snap?.nodePtyAvailable
        ? "node-pty activo"
        : "Fallback spawn-pipe (instala node-pty para PTY real)";
    }
    unsubData = window.editcorePty.onData((payload) => {
      if (!payload || String(payload.id) !== sessionId) return;
      term.write(String(payload.data || ""));
    });
    term.clear();
    term.writeln(`\x1b[90mEditCoreAI terminal · ${snap?.backend || "unknown"} · ${snap?.cwd || ""}\x1b[0m`);
    term.focus();
    booted = true;
    return snap;
  }

  async function show() {
    const panel = panelEl();
    if (panel) {
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("ide-terminal-open");
    const tab = document.querySelector('.viewer-logs-tab[data-tab="terminal"]');
    const logsTab = document.querySelector('.viewer-logs-tab[data-tab="logs"]');
    if (tab) tab.classList.add("active");
    if (logsTab) logsTab.classList.remove("active");
    const logsContent = document.getElementById("tab-logs");
    const termContent = document.getElementById("tab-terminal");
    if (logsContent) logsContent.classList.remove("active");
    if (termContent) termContent.classList.add("active");
    // Expand logs panel shell if collapsed
    const logsPanel = document.getElementById("logsPanel");
    if (logsPanel) {
      logsPanel.hidden = false;
      logsPanel.classList.remove("collapsed");
      logsPanel.setAttribute("aria-hidden", "false");
    }
    const split = document.getElementById("splitPreviewLogs");
    if (split) {
      split.hidden = false;
      split.classList.remove("collapsed");
    }
    await ensureTerminal();
    if (!booted || !sessionId) {
      await start(window.state?.projectRoot || "");
    } else {
      try { fitAddon?.fit(); } catch { /* ignore */ }
      term?.focus();
    }
  }

  function hide() {
    document.body.classList.remove("ide-terminal-open");
  }

  function fit() {
    try { fitAddon?.fit(); } catch { /* ignore */ }
    if (sessionId && term && window.editcorePty?.resize) {
      window.editcorePty.resize({ id: sessionId, cols: term.cols, rows: term.rows }).catch(() => undefined);
    }
  }

  function writeAgentCommand(command = "") {
    const cmd = String(command || "").trim();
    if (!cmd || !term) return;
    term.writeln(`\r\n\x1b[36m$ ${cmd}\x1b[0m`);
    if (sessionId && window.editcorePty?.write) {
      window.editcorePty.write({ id: sessionId, data: `${cmd}\r` }).catch(() => undefined);
    }
  }

  global.EditCoreTerminal = {
    show,
    hide,
    start,
    fit,
    writeAgentCommand,
    ensureTerminal,
  };
})(typeof window !== "undefined" ? window : globalThis);
