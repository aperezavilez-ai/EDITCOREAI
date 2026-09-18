"use strict";

/**
 * Ghost Text + markers para Monaco integrados con LSPClient.
 * - Muestra sugerencias inline (ghost text) desde completion items.
 * - Aplica squiggles/DiagnosticsCollection del LSP.
 */

const { LSPClient } = require("./lsp-client");

class LSPGhostText {
  constructor(monacoInstance) {
    this.monaco = monacoInstance;
    this.clients = new Map();
    this.diagnosticsCollection = null;
    this.disposables = [];
    this.ghostTextDecorationId = "lsp-ghost-text";
    this._initDiagnostics();
  }

  _initDiagnostics() {
    if (!this.monaco?.languages) return;
    this.diagnosticsCollection = this.monaco.languages.createDiagnosticCollection("editcore-lsp");
    this.disposables.push(this.diagnosticsCollection);
  }

  attachEditor(editor, model, rootPath, languageId) {
    if (!editor || !model) return;
    const uri = model.uri?.toString?.() || String(rootPath || "").replace(/\\/g, "/");
    let client = this.clients.get(uri);
    if (!client) {
      client = new LSPClient(rootPath, languageId);
      client.start();
      client.on("diagnostics", ({ diagnostics }) => {
        if (!this.diagnosticsCollection) return;
        const markers = (diagnostics || []).map((d) => {
          const range = this._toRange(d.range);
          return {
            severity: this._mapSeverity(d.severity),
            message: String(d.message || ""),
            source: String(d.source || "lsp"),
            startLineNumber: range?.startLineNumber || 1,
            startColumn: range?.startColumn || 1,
            endLineNumber: range?.endLineNumber || 1,
            endColumn: range?.endColumn || 1,
          };
        });
        this.diagnosticsCollection.set(model.uri, markers);
      });
      this.clients.set(uri, client);
    }

    this.disposables.push(
      editor.onDidChangeCursorPosition((e) => {
        const pos = e?.position;
        if (!pos) return;
        this._requestHoverAndCompletion(editor, model, client, pos);
      })
    );

    this.disposables.push(
      model.onDidChangeContent(() => {
        client.changeDocument(uri, model.getValue());
      })
    );

    client.openDocument(uri, languageId, model.getValue());
  }

  detachEditor(editor, model) {
    if (!model) return;
    const uri = model.uri?.toString?.() || "";
    const client = this.clients.get(uri);
    if (client) {
      client.stop();
      this.clients.delete(uri);
    }
    if (this.diagnosticsCollection) this.diagnosticsCollection.set(model.uri, []);
  }

  dispose() {
    for (const client of this.clients.values()) client.stop();
    this.clients.clear();
    for (const d of this.disposables) {
      try { d.dispose?.(); } catch {}
    }
    this.disposables = [];
  }

  async _requestHoverAndCompletion(editor, model, client, position) {
    if (!client?.ready) return;
    try {
      const hover = await client.requestHover(model.uri?.toString?.() || "", position.lineNumber - 1, position.column - 1);
      if (hover?.contents?.value) {
        this._showHover(editor, position, String(hover.contents.value));
      }
      const completion = await client.requestCompletion(model.uri?.toString?.() || "", position.lineNumber - 1, position.column - 1);
      if (completion?.items?.length) {
        this._applyGhostText(editor, position, completion.items[0]);
      }
    } catch {
      // noop
    }
  }

  _applyGhostText(editor, position, item) {
    const insertText = String(item.insertText || item.label || "");
    if (!insertText) return;
    const decorations = editor.deltaDecorations(
      editor.getModel()?.getAllDecorations?.() || [],
      [
        {
          range: new this.monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          options: {
            after: { content: insertText, inlineClassName: "lsp-ghost-text" },
            hoverMessage: { value: String(item.detail || "") },
          },
        },
      ]
    );
  }

  _showHover(editor, position, markdown) {
    if (!editor?.trigger) return;
    editor.trigger("lsp", "editor.action.showHover", {});
  }

  _toRange(range) {
    if (!range || !this.monaco) return null;
    return new this.monaco.Range(
      (range.start?.line ?? 1) + 1,
      (range.start?.character ?? 0) + 1,
      (range.end?.line ?? 1) + 1,
      (range.end?.character ?? 0) + 1
    );
  }

  _mapSeverity(severity) {
    const map = { 1: this.monaco?.MarkerSeverity.Error, 2: this.monaco?.MarkerSeverity.Warning, 3: this.monaco?.MarkerSeverity.Info, 4: this.monaco?.MarkerSeverity.Hint };
    return map[Number(severity)] || this.monaco?.MarkerSeverity.Info || 4;
  }
}

module.exports = { LSPGhostText };
