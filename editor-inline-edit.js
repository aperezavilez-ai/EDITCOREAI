"use strict";
(function () {
  const state = {
    editor: null,
    monaco: null,
    widget: null,
    diffEditor: null,
    diffContainer: null,
    originalModel: null,
    modifiedModel: null,
    lastSelection: null,
    lastInstruction: "",
    lastProposal: "",
    generating: false,
    activeRequestId: 0,
    slowTimer: null,
  };

  function getEditor() {
    const monaco = window.monaco || window.__monaco;
    let ed = window.EditCoreEditor?.getMonacoEditor?.()
      || window.EditCoreEditor?._editor
      || window.__monacoEditor
      || null;
    if (!ed && monaco?.editor?.getEditors) {
      const list = monaco.editor.getEditors() || [];
      ed = list.find((item) => item?.getDomNode?.()?.isConnected) || list[0] || null;
    }
    if (!ed && monaco?.editor?.getFocusedCodeEditor) {
      ed = monaco.editor.getFocusedCodeEditor() || null;
    }
    if (!ed || !monaco) return null;
    return { editor: ed, monaco };
  }

  function clearSlowTimer() {
    if (state.slowTimer) {
      clearTimeout(state.slowTimer);
      state.slowTimer = null;
    }
  }

  function destroyWidget() {
    clearSlowTimer();
    if (state.widget) {
      state.widget.remove();
      state.widget = null;
    }
  }

  function destroyDiff() {
    if (state.diffEditor) {
      try { state.diffEditor.dispose(); } catch { /* ignore */ }
      state.diffEditor = null;
    }
    if (state.originalModel) {
      try { state.originalModel.dispose(); } catch { /* ignore */ }
      state.originalModel = null;
    }
    if (state.modifiedModel) {
      try { state.modifiedModel.dispose(); } catch { /* ignore */ }
      state.modifiedModel = null;
    }
    if (state.diffContainer) {
      state.diffContainer.remove();
      state.diffContainer = null;
    }
  }

  function restoreEditor() {
    const ctx = getEditor();
    destroyDiff();
    document.body.classList.remove("inline-edit-diff-active");
    if (ctx?.editor) {
      try { ctx.editor.updateOptions({ readOnly: false }); } catch { /* ignore */ }
      try { ctx.editor.focus(); } catch { /* ignore */ }
    }
  }

  function showToast(message) {
    const t = document.createElement("div");
    t.className = "inline-edit-toast";
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("visible"), 20);
    setTimeout(() => {
      t.classList.remove("visible");
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }

  function sanitizeProposal(raw = "") {
    let proposal = String(raw || "").trim();
    if (!proposal) return "";
    const fenced = proposal.match(/```[\w-]*\r?\n([\s\S]*?)\r?\n```/);
    if (fenced) proposal = fenced[1];
    proposal = proposal.replace(/^```[\w-]*\r?\n?/, "").replace(/\r?\n?```$/, "").trim();
    return proposal;
  }

  function buildModifiedFull(original, sel, proposal) {
    const lines = String(original || "").split("\n");
    const beforeLines = lines.slice(0, Math.max(0, sel.startLine - 1));
    const afterLines = lines.slice(Math.max(0, sel.endLine));
    const proposalLines = String(proposal || "").split("\n");
    if (!sel.selectedText && !String(proposal || "").trim()) {
      return original;
    }
    if (!sel.selectedText) {
      const insertAt = Math.max(0, sel.startLine - 1);
      return [
        ...lines.slice(0, insertAt),
        ...proposalLines,
        ...lines.slice(insertAt),
      ].join("\n");
    }
    return [...beforeLines, ...proposalLines, ...afterLines].join("\n");
  }

  async function openWidget() {
    try {
      if (typeof window.EditCoreEditor?.showCodeModeAsync === "function") {
        await window.EditCoreEditor.showCodeModeAsync().catch(() => undefined);
      }
      if (typeof window.EditCoreEditor?.ensureEditor === "function") {
        const ed = await window.EditCoreEditor.ensureEditor();
        window.__monacoEditor = ed;
        window.EditCoreEditor._editor = ed;
        if (!window.EditCoreEditor.getMonacoEditor) {
          window.EditCoreEditor.getMonacoEditor = () => window.__monacoEditor || window.EditCoreEditor._editor || null;
        }
      }
    } catch { /* ignore */ }

    const ctx = getEditor();
    if (!ctx) {
      showToast("Abrí la pestaña Código y un archivo primero");
      return;
    }
    const { editor, monaco } = ctx;
    bindMonacoShortcut(editor, monaco);
    state.editor = editor;
    state.monaco = monaco;

    const path = String(window.EditCoreEditor?.getCurrentPath?.() || "").trim();
    if (!path) {
      showToast("Abrí un archivo primero");
      return;
    }

    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model) return;

    const hasSelection = !selection.isEmpty();
    const startLine = selection.startLineNumber;
    const endLine = hasSelection ? selection.endLineNumber : selection.startLineNumber;
    const selectedText = hasSelection ? model.getValueInRange(selection) : "";

    const beforeStart = Math.max(1, startLine - 10);
    let before = "";
    if (startLine > 1) {
      const endCol = model.getLineMaxColumn(startLine - 1);
      before = model.getValueInRange(new monaco.Range(beforeStart, 1, startLine - 1, endCol));
    }
    const afterEnd = Math.min(model.getLineCount(), endLine + 10);
    let after = "";
    if (endLine < model.getLineCount()) {
      const endCol = model.getLineMaxColumn(Math.min(afterEnd, model.getLineCount()));
      after = model.getValueInRange(new monaco.Range(endLine + 1, 1, Math.min(afterEnd, model.getLineCount()), endCol));
    }

    state.lastSelection = {
      startLine,
      endLine,
      startColumn: hasSelection ? selection.startColumn : 1,
      endColumn: hasSelection ? selection.endColumn : 1,
      selectedText,
      before,
      after,
      language: model.getLanguageId() || "plaintext",
      path,
      fullOriginal: model.getValue(),
    };

    const pos = editor.getScrolledVisiblePosition({ lineNumber: startLine, column: 1 });
    const editorDom = editor.getDomNode();
    if (!pos || !editorDom) return;
    const rect = editorDom.getBoundingClientRect();

    destroyWidget();
    const widget = document.createElement("div");
    widget.className = "inline-edit-widget";
    widget.innerHTML = `
      <div class="inline-edit-widget-head">
        <span class="inline-edit-icon">✦</span>
        <span class="inline-edit-title">Editar con IA</span>
        <button type="button" class="inline-edit-close" aria-label="Cancelar">×</button>
      </div>
      <textarea class="inline-edit-input" rows="2"
        placeholder="Instrucción para editar… (Enter=generar, Shift+Enter=nueva línea, Esc=cancelar)"></textarea>
      <div class="inline-edit-actions">
        <button type="button" class="inline-edit-generate">Generar</button>
      </div>
      <div class="inline-edit-error" hidden></div>
    `;
    widget.style.position = "absolute";
    widget.style.left = `${Math.max(8, Math.min(rect.left + pos.left, window.innerWidth - 400))}px`;
    widget.style.top = `${Math.max(8, rect.top + pos.top - 90)}px`;
    widget.style.zIndex = "10000";
    document.body.appendChild(widget);
    state.widget = widget;

    const input = widget.querySelector(".inline-edit-input");
    const btn = widget.querySelector(".inline-edit-generate");
    const closeBtn = widget.querySelector(".inline-edit-close");

    if (state.lastInstruction) input.value = state.lastInstruction;
    input.focus();
    if (state.lastInstruction) input.select();

    const submit = () => {
      const instruction = input.value.trim();
      if (!instruction || state.generating) return;
      state.lastInstruction = instruction;
      generate(instruction);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelAll();
      }
    });
    btn.addEventListener("click", submit);
    closeBtn.addEventListener("click", cancelAll);
  }

  async function generate(instruction) {
    if (!state.lastSelection || state.generating) return;
    if (typeof window.editcoreInlineEdit?.generate !== "function") {
      showToast("Inline Edit no está disponible");
      return;
    }
    state.generating = true;
    const reqId = ++state.activeRequestId;

    const widget = state.widget;
    if (!widget) {
      state.generating = false;
      return;
    }
    widget.querySelector(".inline-edit-actions").innerHTML =
      `<span class="inline-edit-spinner">Generando…</span>`;
    const errorBox = widget.querySelector(".inline-edit-error");
    errorBox.hidden = true;
    errorBox.textContent = "";

    clearSlowTimer();
    state.slowTimer = setTimeout(() => {
      if (reqId !== state.activeRequestId || !state.widget) return;
      const spinner = state.widget.querySelector(".inline-edit-spinner");
      if (spinner) spinner.textContent = "El modelo está tardando…";
    }, 30_000);

    try {
      const creds = window.__editcoreActiveProvider || {};
      const result = await window.editcoreInlineEdit.generate({
        path: state.lastSelection.path,
        language: state.lastSelection.language,
        startLine: state.lastSelection.startLine,
        endLine: state.lastSelection.endLine,
        before: state.lastSelection.before,
        selection: state.lastSelection.selectedText,
        after: state.lastSelection.after,
        instruction,
        previousProposal: state.lastProposal || "",
        model: creds.model || "",
        providerKey: creds.providerKey || "",
        apiKey: creds.apiKey || "",
        baseUrl: creds.baseUrl || "",
      });

      if (reqId !== state.activeRequestId) return;

      if (!result?.ok) {
        throw new Error(result?.error || "El modelo no devolvió una propuesta.");
      }
      const proposal = sanitizeProposal(result.proposal);
      if (!proposal) throw new Error("El modelo devolvió una respuesta vacía.");
      state.lastProposal = proposal;
      state.generating = false;
      clearSlowTimer();
      destroyWidget();
      showDiff(proposal);
    } catch (err) {
      state.generating = false;
      clearSlowTimer();
      if (reqId !== state.activeRequestId) return;
      const w = state.widget;
      if (w) {
        w.querySelector(".inline-edit-actions").innerHTML =
          `<button type="button" class="inline-edit-generate">Reintentar</button>
           <button type="button" class="inline-edit-btn inline-edit-btn-reject">Cancelar</button>`;
        w.querySelector(".inline-edit-generate").addEventListener("click", () => generate(state.lastInstruction));
        w.querySelector(".inline-edit-btn-reject")?.addEventListener("click", cancelAll);
        const eb = w.querySelector(".inline-edit-error");
        eb.hidden = false;
        eb.textContent = `No pude generar la edición: ${String(err?.message || err).slice(0, 220)}`;
      }
    }
  }

  function showDiff(proposal) {
    const ctx = getEditor();
    if (!ctx) return;
    const { editor, monaco } = ctx;
    const sel = state.lastSelection;
    if (!sel) return;

    const editorDom = editor.getDomNode();
    if (!editorDom) return;
    const rect = editorDom.getBoundingClientRect();

    const container = document.createElement("div");
    container.className = "inline-edit-diff-container";
    container.style.position = "absolute";
    container.style.left = `${rect.left}px`;
    container.style.top = `${rect.top}px`;
    container.style.width = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
    container.style.zIndex = "9000";

    const diffHost = document.createElement("div");
    diffHost.className = "inline-edit-diff-host";
    container.appendChild(diffHost);

    const actions = document.createElement("div");
    actions.className = "inline-edit-diff-actions";
    actions.innerHTML = `
      <button type="button" class="inline-edit-btn inline-edit-btn-reject">✗ Rechazar (Esc)</button>
      <button type="button" class="inline-edit-btn inline-edit-btn-refine">✎ Refinar</button>
      <button type="button" class="inline-edit-btn inline-edit-btn-accept primary">✓ Aceptar (Enter)</button>
    `;
    container.appendChild(actions);

    document.body.appendChild(container);
    document.body.classList.add("inline-edit-diff-active");
    state.diffContainer = container;

    const fullOriginal = sel.fullOriginal != null ? sel.fullOriginal : editor.getValue();
    const newFull = buildModifiedFull(fullOriginal, sel, proposal);
    state.originalModel = monaco.editor.createModel(fullOriginal, sel.language);
    state.modifiedModel = monaco.editor.createModel(newFull, sel.language);

    state.diffEditor = monaco.editor.createDiffEditor(diffHost, {
      readOnly: true,
      originalEditable: false,
      renderSideBySide: false,
      ignoreTrimWhitespace: false,
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    state.diffEditor.setModel({
      original: state.originalModel,
      modified: state.modifiedModel,
    });

    setTimeout(() => {
      try {
        state.diffEditor.getModifiedEditor().revealLineInCenter(sel.startLine);
      } catch { /* ignore */ }
    }, 120);

    actions.querySelector(".inline-edit-btn-accept").addEventListener("click", accept);
    actions.querySelector(".inline-edit-btn-reject").addEventListener("click", reject);
    actions.querySelector(".inline-edit-btn-refine").addEventListener("click", () => {
      const prev = state.lastInstruction;
      const prevProposal = state.lastProposal;
      restoreEditor();
      state.lastInstruction = prev;
      state.lastProposal = prevProposal;
      openWidget();
    });
  }

  async function accept() {
    const ctx = getEditor();
    if (!ctx || !state.lastSelection || !state.lastProposal) return;
    const sel = state.lastSelection;
    const path = sel.path;
    if (!path) {
      showToast("No se puede aplicar: falta el path del archivo.");
      return;
    }

    const fullOriginal = sel.fullOriginal != null ? sel.fullOriginal : ctx.editor.getValue();
    const newFull = buildModifiedFull(fullOriginal, sel, state.lastProposal);
    const projectRoot = String(window.state?.projectRoot || "").trim();

    try {
      if (typeof window.editcorePatch?.apply !== "function") {
        throw new Error("patch:apply no disponible");
      }
      const res = await window.editcorePatch.apply(path, newFull, {
        oldText: fullOriginal,
        newText: newFull,
        replaceAll: false,
        projectRoot,
      });
      if (!res?.ok && !res?.skipped) {
        throw new Error(res?.error || "No se pudo aplicar el cambio.");
      }

      const model = ctx.editor.getModel();
      if (model) {
        const fullRange = model.getFullModelRange();
        ctx.editor.executeEdits("inline-edit", [{
          range: fullRange,
          text: newFull,
          forceMoveMarkers: true,
        }]);
      } else {
        ctx.editor.setValue(newFull);
      }

      const proposalLines = state.lastProposal.split("\n").length;
      const endLine = sel.selectedText
        ? sel.startLine + proposalLines - 1
        : sel.startLine + proposalLines - 1;
      try {
        ctx.editor.setPosition({ lineNumber: Math.max(1, endLine), column: 1 });
        ctx.editor.revealLineInCenter(Math.max(1, endLine));
      } catch { /* ignore */ }

      restoreEditor();
      state.lastInstruction = "";
      state.lastProposal = "";
      state.lastSelection = null;
      showToast("Cambio aplicado · Ctrl+Z para deshacer");
      try { await window.EditCoreEditor?.saveCurrent?.(); } catch { /* already on disk */ }
    } catch (err) {
      showToast(`No pude aplicar: ${String(err?.message || err).slice(0, 180)}`);
    }
  }

  function reject() {
    restoreEditor();
    state.lastInstruction = "";
    state.lastProposal = "";
    state.lastSelection = null;
  }

  function cancelAll() {
    state.activeRequestId += 1;
    state.generating = false;
    clearSlowTimer();
    destroyWidget();
    restoreEditor();
    state.lastInstruction = "";
    state.lastProposal = "";
    state.lastSelection = null;
  }

  window.addEventListener("keydown", (e) => {
    const isK = e.key === "k" || e.key === "K" || e.code === "KeyK";
    const mod = e.ctrlKey || e.metaKey;
    if (mod && isK && !e.shiftKey && !e.altKey) {
      const ae = document.activeElement;
      if (ae?.classList?.contains("inline-edit-input")) return;
      if (ae?.id === "prompt") return;
      const inMonaco = Boolean(
        ae?.closest?.(".monaco-editor")
        || ae?.closest?.("#monacoEditorHost")
        || ae?.classList?.contains("inputarea"),
      );
      const inChatUi = Boolean(
        ae?.closest?.(".composer-bar")
        || ae?.closest?.("#feed")
        || ae?.closest?.(".chat-panel"),
      );
      // No interferir con inputs de UI (chat, forms). Monaco SÍ debe abrir Inline Edit.
      if ((ae?.tagName === "TEXTAREA" || ae?.tagName === "INPUT") && !inMonaco) {
        if (inChatUi || ae?.id === "prompt") return;
        if (!document.body.classList.contains("ide-code-mode")) return;
      }
      e.preventDefault();
      e.stopPropagation();
      try { e.stopImmediatePropagation(); } catch { /* ignore */ }
      void openWidget();
      return;
    }
    if (e.key === "Escape" && (state.widget || state.diffContainer)) {
      e.preventDefault();
      cancelAll();
      return;
    }
    if (e.key === "Enter" && state.diffContainer && !state.widget) {
      if (document.activeElement?.classList?.contains("inline-edit-input")) return;
      if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") {
        if (!document.activeElement?.closest?.(".inline-edit-diff-container")) return;
      }
      const acceptBtn = state.diffContainer.querySelector(".inline-edit-btn-accept");
      if (acceptBtn) {
        e.preventDefault();
        acceptBtn.click();
      }
    }
  }, true);

  function bindMonacoShortcut(editor, monaco) {
    if (!editor || !monaco || editor.__editcoreInlineEditBound) return;
    editor.__editcoreInlineEditBound = true;
    try {
      editor.addAction({
        id: "editcore-inline-edit",
        label: "Editar con IA (Inline Edit)",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        precondition: null,
        keybindingContext: null,
        run: () => { void openWidget(); },
      });
    } catch { /* ignore */ }
  }

  window.EditCoreInlineEdit = {
    open: openWidget,
    cancel: cancelAll,
    bindMonacoShortcut,
    _state: state,
  };
})();
