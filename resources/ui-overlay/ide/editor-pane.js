"use strict";

/**
 * Monaco editor host for EditCoreAI (renderer).
 * Loads AMD monaco from node_modules; exposes window.EditCoreEditor.
 */
(function initEditCoreEditor(global) {
  const LANGUAGE_BY_EXT = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    xml: "xml",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
    sh: "shell",
    bat: "bat",
    ps1: "powershell",
    txt: "plaintext",
  };

  const EMPTY_HINT = [
    "// Editor de código EditCoreAI",
    "//",
    "// 1) Haz clic en un archivo del panel derecho (p. ej. package.json)",
    "// 2) O deja que el agente edite: se abrirá solo aquí",
    "//",
    "// Ctrl+S guardar · F12 ir a definición",
    "",
  ].join("\n");

  let monacoApi = null;
  let editor = null;
  let loadPromise = null;
  let currentPath = "";
  let dirty = false;
  const decorationIds = { gutter: [] };

  function hostEl() {
    return document.getElementById("monacoEditorHost");
  }

  function pathLabelEl() {
    return document.getElementById("editorPathLabel");
  }

  function statusEl() {
    return document.getElementById("status");
  }

  function setStatus(msg) {
    const el = statusEl();
    if (el) el.textContent = String(msg || "").slice(0, 180);
  }

  function setPathLabel(rel, isDirty) {
    const el = pathLabelEl();
    if (!el) return;
    el.textContent = rel ? `${rel}${isDirty ? " •" : ""}` : "Sin archivo";
    el.title = rel || "";
  }

  function languageFor(rel = "") {
    const ext = String(rel).split(".").pop()?.toLowerCase() || "";
    return LANGUAGE_BY_EXT[ext] || "plaintext";
  }

  function isDarkAppTheme() {
    const theme = String(document.documentElement.getAttribute("data-theme") || "").toLowerCase();
    return theme === "gris" || theme === "negro" || theme === "azul" || theme === "dark";
  }

  function monacoThemeName() {
    return isDarkAppTheme() ? "vs-dark" : "vs";
  }

  function applyTheme() {
    const name = monacoThemeName();
    try {
      if (monacoApi?.editor?.setTheme) monacoApi.editor.setTheme(name);
      else if (editor && monacoApi) monacoApi.editor.setTheme(name);
    } catch { /* ignore */ }
    return name;
  }

  function resolveMonacoBase() {
    // Preferir ruta relativa (mismo origen que index.html). file:// absoluto rompe AMD/CSP.
    const relative = "./node_modules/monaco-editor/min/vs";
    try {
      const fromPreload = global.editcoreIdeAssets?.monacoVs?.();
      if (fromPreload && !String(fromPreload).startsWith("file:")) {
        return String(fromPreload).replace(/\/+$/, "");
      }
    } catch { /* ignore */ }
    return relative;
  }

  function ensureMonacoCss(base) {
    const id = "monaco-editor-css";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `${base}/editor/editor.main.css`;
    document.head.appendChild(link);
  }

  function ensureMonaco() {
    if (monacoApi) return Promise.resolve(monacoApi);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const base = resolveMonacoBase();
      ensureMonacoCss(base);
      global.MonacoEnvironment = {
        getWorkerUrl(_moduleId, _label) {
          // Workers locales (sin blob) para respetar CSP Electron.
          return `${base}/base/worker/workerMain.js`;
        },
      };

      const boot = () => {
        const req = global.require;
        if (typeof req !== "function") {
          reject(new Error("Monaco AMD loader no disponible."));
          return;
        }
        try {
          req.config({ paths: { vs: base } });
        } catch { /* already configured */ }
        req(
          ["vs/editor/editor.main"],
          () => {
            if (!global.monaco?.editor) {
              reject(new Error("monaco.editor no cargó."));
              return;
            }
            monacoApi = global.monaco;
            resolve(monacoApi);
          },
          (err) => reject(err || new Error("Fallo require Monaco")),
        );
      };

      const existing = document.querySelector('script[data-monaco-loader="1"]');
      if (existing) {
        if (typeof global.require === "function") boot();
        else existing.addEventListener("load", boot, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = `${base}/loader.js`;
      script.async = true;
      script.dataset.monacoLoader = "1";
      script.onload = boot;
      script.onerror = () => {
        loadPromise = null;
        reject(new Error(`No se pudo cargar Monaco (${base}/loader.js).`));
      };
      document.head.appendChild(script);
    }).catch((err) => {
      loadPromise = null;
      throw err;
    });
    return loadPromise;
  }

  async function ensureEditor() {
    const monaco = await ensureMonaco();
    const host = hostEl();
    if (!host) throw new Error("Falta #monacoEditorHost en index.html");
    host.hidden = false;
    host.removeAttribute("hidden");
    host.style.display = "block";
    if (editor) {
      requestAnimationFrame(() => editor.layout());
      return editor;
    }
    editor = monaco.editor.create(host, {
      value: EMPTY_HINT,
      language: "javascript",
      theme: monacoThemeName(),
      automaticLayout: true,
      minimap: { enabled: true, scale: 0.75 },
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      multiCursorModifier: "alt",
      glyphMargin: true,
      lineNumbers: "on",
      wordWrap: "on",
      tabSize: 2,
      padding: { top: 8 },
    });
    editor.onDidChangeModelContent(() => {
      if (!currentPath) return;
      dirty = true;
      setPathLabel(currentPath, true);
    });
    editor.addAction({
      id: "editcore-save",
      label: "Guardar archivo",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => { saveCurrent().catch(() => undefined); },
    });
    editor.addAction({
      id: "editcore-goto-def",
      label: "Go to Definition",
      keybindings: [monaco.KeyCode.F12],
      run: () => { goToDefinition().catch(() => undefined); },
    });
    editor.addAction({
      id: "editcore-inline-edit",
      label: "Editar con IA (Inline Edit)",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => {
        try { window.EditCoreInlineEdit?.open?.(); } catch { /* ignore */ }
      },
    });
    requestAnimationFrame(() => editor.layout());
    return editor;
  }

  async function openFile(projectRoot, relativePath, options = {}) {
    const root = String(projectRoot || "").trim();
    const rel = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!root || !rel) throw new Error("Falta proyecto o ruta.");
    if (!window.editcoreProject?.readText) throw new Error("IPC project:read-text no disponible.");

    await showCodeModeAsync();
    const ed = await ensureEditor();
    const payload = await window.editcoreProject.readText({ projectRoot: root, path: rel });
    const content = String(payload?.content ?? "");
    const language = languageFor(rel);
    const model = monacoApi.editor.createModel(content, language);
    const prev = ed.getModel();
    ed.setModel(model);
    try { prev?.dispose?.(); } catch { /* ignore */ }

    currentPath = rel;
    dirty = false;
    setPathLabel(rel, false);
    setStatus(`Abierto: ${rel}`);

    const line = Math.max(1, Number(options.line) || 0);
    const column = Math.max(1, Number(options.column) || 1);
    if (line > 1 || options.line) {
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column });
      ed.focus();
    } else {
      ed.focus();
    }
    if (options.unifiedDiff && typeof options.unifiedDiff === "string") {
      // gutters se aplican desde renderer via applyGutterDiffs
    }
    requestAnimationFrame(() => ed.layout());
    return { path: rel, bytes: content.length };
  }

  function applyGutterDiffs(marks = []) {
    if (!editor || !monacoApi) return;
    const decorations = [];
    for (const mark of marks) {
      const line = Number(mark.line) || 0;
      if (line < 1) continue;
      const kind = String(mark.kind || "add");
      decorations.push({
        range: new monacoApi.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: kind === "del" ? "monaco-diff-line-del" : "monaco-diff-line-add",
          glyphMarginClassName: kind === "del" ? "monaco-diff-glyph-del" : "monaco-diff-glyph-add",
          glyphMarginHoverMessage: { value: kind === "del" ? "Línea eliminada" : "Línea añadida" },
        },
      });
    }
    decorationIds.gutter = editor.deltaDecorations(decorationIds.gutter, decorations);
  }

  function clearGutterDiffs() {
    if (!editor) return;
    decorationIds.gutter = editor.deltaDecorations(decorationIds.gutter, []);
  }

  async function saveCurrent() {
    if (!currentPath || !editor) return { ok: false };
    const projectRoot = window.state?.projectRoot || "";
    if (!projectRoot) throw new Error("Sin proyecto activo.");
    if (!window.editcoreProject?.saveEditor) throw new Error("IPC project:save-editor no disponible.");
    const content = editor.getValue();
    await window.editcoreProject.saveEditor({ projectRoot, path: currentPath, content });
    dirty = false;
    setPathLabel(currentPath, false);
    setStatus(`Guardado: ${currentPath}`);
    return { ok: true, path: currentPath };
  }

  async function goToDefinition() {
    if (!editor || !currentPath) return;
    const model = editor.getModel();
    const pos = editor.getPosition();
    if (!model || !pos) return;
    const word = model.getWordAtPosition(pos);
    if (!word?.word) return;
    const projectRoot = window.state?.projectRoot || "";
    if (!projectRoot || !window.editcoreProject?.gotoDefinition) {
      const text = model.getValue().split(/\r?\n/);
      const re = new RegExp(`(?:function|class|const|let|var|type|interface|def)\\s+${word.word}\\b`);
      for (let i = 0; i < text.length; i += 1) {
        if (re.test(text[i]) && i + 1 !== pos.lineNumber) {
          editor.revealLineInCenter(i + 1);
          editor.setPosition({ lineNumber: i + 1, column: 1 });
          return;
        }
      }
      return;
    }
    const hit = await window.editcoreProject.gotoDefinition({
      projectRoot,
      symbol: word.word,
      fromPath: currentPath,
    });
    if (hit?.path) {
      await openFile(projectRoot, hit.path, { line: hit.line || 1, column: hit.column || 1 });
    } else {
      setStatus(`Sin definición para ${word.word}`);
    }
  }

  function hidePreviewChrome() {
    const status = document.getElementById("previewStatus");
    if (status) {
      status.classList.add("hidden");
      status.hidden = true;
    }
    const webview = document.getElementById("previewWebview");
    if (webview) {
      webview.classList.add("is-hidden-for-editor");
      webview.style.visibility = "hidden";
    }
  }

  function showPreviewChrome() {
    const webview = document.getElementById("previewWebview");
    if (webview) {
      webview.classList.remove("is-hidden-for-editor");
      webview.style.visibility = "";
    }
  }

  async function showCodeModeAsync() {
    document.body.classList.add("ide-code-mode");
    document.body.classList.remove("ide-web-mode");
    const codeBtn = document.getElementById("codePreviewBtn");
    const webBtn = document.getElementById("webPreviewBtn");
    const mobileBtn = document.getElementById("mobilePreviewBtn");
    if (codeBtn) codeBtn.classList.add("active");
    if (webBtn) webBtn.classList.remove("active");
    if (mobileBtn) mobileBtn.classList.remove("active");
    hidePreviewChrome();
    const host = hostEl();
    if (host) {
      host.hidden = false;
      host.removeAttribute("hidden");
      host.style.display = "block";
      host.style.visibility = "visible";
      host.style.zIndex = "5";
      host.style.pointerEvents = "auto";
    }
    // Webview NO se destruye ni se navega: solo se oculta (CSS + clase).
    const ed = await ensureEditor();
    requestAnimationFrame(() => {
      try { ed.layout(); } catch { /* ignore */ }
    });
    return ed;
  }

  function showCodeMode() {
    showCodeModeAsync().catch((err) => {
      setStatus(`Editor: ${err?.message || err}`);
    });
  }

  function showWebMode() {
    document.body.classList.add("ide-web-mode");
    document.body.classList.remove("ide-code-mode");
    const codeBtn = document.getElementById("codePreviewBtn");
    const webBtn = document.getElementById("webPreviewBtn");
    const mobileBtn = document.getElementById("mobilePreviewBtn");
    if (webBtn) webBtn.classList.add("active");
    if (codeBtn) codeBtn.classList.remove("active");
    if (mobileBtn) mobileBtn.classList.remove("active");
    const host = hostEl();
    if (host) {
      host.hidden = true;
      host.setAttribute("hidden", "");
      host.style.display = "none";
      host.style.visibility = "hidden";
      host.style.zIndex = "0";
      host.style.pointerEvents = "none";
    }
    showPreviewChrome();
    const webview = document.getElementById("previewWebview");
    if (webview) {
      webview.classList.remove("is-hidden-for-editor");
      webview.style.visibility = "visible";
      webview.style.display = "";
      webview.style.pointerEvents = "auto";
      webview.style.zIndex = "1";
    }
    const status = document.getElementById("previewStatus");
    const hasUrl = Boolean(String(document.getElementById("previewUrl")?.value || "").trim())
      || Boolean(webview?.getURL?.());
    if (status && !hasUrl) {
      status.classList.remove("hidden");
      status.hidden = false;
    } else if (status && hasUrl) {
      status.classList.add("hidden");
      status.hidden = true;
    }
  }

  function getCurrentPath() {
    return currentPath;
  }

  function isDirty() {
    return dirty;
  }

  function layout() {
    editor?.layout();
  }

  global.EditCoreEditor = {
    ensureEditor,
    openFile,
    saveCurrent,
    goToDefinition,
    applyGutterDiffs,
    clearGutterDiffs,
    showCodeMode,
    showCodeModeAsync,
    showWebMode,
    applyTheme,
    getCurrentPath,
    isDirty,
    layout,
  };
})(typeof window !== "undefined" ? window : globalThis);
