const { AstRefactorer } = require("./ast-refactorer");

class CodeActionsProvider {
  constructor(options = {}) {
    this.refactorer = new AstRefactorer(options.refactorer || {});
    this.actions = new Map();
    this.diagnostics = [];
    this.registerBuiltinActions();
  }

  registerBuiltinActions() {
    this.actions.set("ast.renameSymbol", {
      id: "ast.renameSymbol",
      title: "Renombrar símbolo",
      kind: "refactor.rename",
      preferred: true,
      handler: async (context) => {
        const { filePath, oldName, newName, scope } = context.arguments || {};
        if (!filePath || !oldName || !newName) {
          return { applied: false, reason: "MISSING_ARGUMENTS" };
        }
        return await this.refactorer.renameSymbol(filePath, oldName, newName, { scope });
      },
    });

    this.actions.set("ast.extractFunction", {
      id: "ast.extractFunction",
      title: "Extraer función",
      kind: "refactor.extract",
      preferred: true,
      handler: async (context) => {
        const { filePath, startLine, endLine, functionName } = context.arguments || {};
        if (!filePath || !startLine || !endLine) {
          return { applied: false, reason: "MISSING_ARGUMENTS" };
        }
        return await this.refactorer.extractFunction(filePath, startLine, endLine, { functionName });
      },
    });

    this.actions.set("ast.restructureClass", {
      id: "ast.restructureClass",
      title: "Restructurar clase",
      kind: "refactor.rewrite",
      preferred: false,
      handler: async (context) => {
        const { filePath, className, options } = context.arguments || {};
        if (!filePath || !className) {
          return { applied: false, reason: "MISSING_ARGUMENTS" };
        }
        return await this.refactorer.restructureClass(filePath, className, options || {});
      },
    });

    this.actions.set("lsp.quickFix", {
      id: "lsp.quickFix",
      title: "Quick fix LSP",
      kind: "quickfix",
      preferred: true,
      handler: async (context) => {
        const { diagnostic, fix } = context.arguments || {};
        if (!diagnostic || !fix) {
          return { applied: false, reason: "MISSING_ARGUMENTS" };
        }
        return this.applyLspFix(diagnostic, fix);
      },
    });

    this.actions.set("swarm.suggestPatch", {
      id: "swarm.suggestPatch",
      title: "Sugerencia del enjambre",
      kind: "refactor.suggest",
      preferred: false,
      handler: async (context) => {
        const { suggestion } = context.arguments || {};
        if (!suggestion) {
          return { applied: false, reason: "MISSING_ARGUMENTS" };
        }
        return this.applySwarmSuggestion(suggestion);
      },
    });
  }

  registerCustomAction(action) {
    if (!action || !action.id || !action.handler) {
      throw new Error("La acción personalizada requiere id y handler");
    }
    this.actions.set(action.id, action);
  }

  async provideCodeActions(context) {
    const { filePath, diagnostics, selection, swarmSuggestions } = context || {};
    if (!filePath) {
      return { actions: [], diagnostics: [] };
    }

    const matchedDiagnostics = diagnostics || this.diagnostics.filter((d) => d.filePath === filePath);
    const actions = [];

    for (const diagnostic of matchedDiagnostics) {
      const renameAction = this.actions.get("ast.renameSymbol");
      if (renameAction && diagnostic.suggestRename) {
        actions.push({
          ...renameAction,
          context: {
            diagnostics: [diagnostic],
            selection,
            arguments: {
              filePath,
              oldName: diagnostic.symbol,
              newName: diagnostic.suggestedName,
              scope: diagnostic.scope || "file",
            },
          },
        });
      }

      const quickFixAction = this.actions.get("lsp.quickFix");
      if (quickFixAction && diagnostic.fixes && diagnostic.fixes.length) {
        for (const fix of diagnostic.fixes) {
          actions.push({
            ...quickFixAction,
            context: {
              diagnostics: [diagnostic],
              selection,
              arguments: { diagnostic, fix },
            },
          });
        }
      }
    }

    if (swarmSuggestions && swarmSuggestions.length) {
      const swarmAction = this.actions.get("swarm.suggestPatch");
      if (swarmAction) {
        for (const suggestion of swarmSuggestions) {
          actions.push({
            ...swarmAction,
            context: {
              diagnostics: matchedDiagnostics,
              selection,
              arguments: { suggestion },
            },
          });
        }
      }
    }

    const extractAction = this.actions.get("ast.extractFunction");
    if (extractAction && selection && selection.startLine && selection.endLine) {
      actions.push({
        ...extractAction,
        context: {
          diagnostics: matchedDiagnostics,
          selection,
          arguments: {
            filePath,
            startLine: selection.startLine,
            endLine: selection.endLine,
            functionName: selection.suggestedFunctionName,
          },
        },
      });
    }

    return { actions, diagnostics: matchedDiagnostics };
  }

  async executeCodeAction(actionContext) {
    const action = this.actions.get(actionContext.id);
    if (!action) {
      return { applied: false, reason: "ACTION_NOT_FOUND", id: actionContext.id };
    }

    try {
      const result = await action.handler(actionContext);
      return { applied: true, action: action.id, result };
    } catch (error) {
      return { applied: false, reason: "EXECUTION_ERROR", id: actionContext.id, error: error.message };
    }
  }

  addDiagnostic(diagnostic) {
    this.diagnostics.push(diagnostic);
  }

  setDiagnostics(diagnostics) {
    this.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  }

  clearDiagnostics() {
    this.diagnostics = [];
  }

  applyLspFix(diagnostic, fix) {
    return {
      applied: true,
      kind: "lsp.quickFix",
      diagnostic: diagnostic.code || diagnostic.message,
      fix: fix.title || fix,
    };
  }

  applySwarmSuggestion(suggestion) {
    return {
      applied: true,
      kind: "swarm.suggestPatch",
      suggestion: suggestion.title || suggestion,
    };
  }

  listActions() {
    return Array.from(this.actions.values()).map((action) => ({
      id: action.id,
      title: action.title,
      kind: action.kind,
      preferred: action.preferred,
    }));
  }
}

module.exports = { CodeActionsProvider };
