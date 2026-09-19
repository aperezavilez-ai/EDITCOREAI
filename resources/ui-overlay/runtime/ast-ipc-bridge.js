const { AstRefactorer } = require("./ast-refactorer");
const { CodeActionsProvider } = require("./code-actions-provider");
const fs = require("node:fs");
const path = require("node:path");

class AstIpcBridge {
  constructor(options = {}) {
    this.refactorer = new AstRefactorer(options.refactorer || {});
    this.provider = new CodeActionsProvider(options.provider || { refactorer: options.refactorer || {} });
    this.ipcMain = options.ipcMain || null;
    this.context = options.context || {};
  }

  register(ipcMain) {
    if (!ipcMain) {
      throw new Error("ipcMain es requerido para registrar el puente AST");
    }

    this.ipcMain = ipcMain;

    ipcMain.handle("ast:parse", async (_event, filePath) => {
      return await this.refactorer.parse(filePath);
    });

    ipcMain.handle("ast:analyze", async (_event, filePath) => {
      return await this.refactorer.analyze(filePath);
    });

    ipcMain.handle("ast:renameSymbol", async (_event, payload) => {
      const { filePath, oldName, newName, scope } = payload || {};
      return await this.refactorer.renameSymbol(filePath, oldName, newName, { scope });
    });

    ipcMain.handle("ast:extractFunction", async (_event, payload) => {
      const { filePath, startLine, endLine, functionName } = payload || {};
      return await this.refactorer.extractFunction(filePath, startLine, endLine, { functionName });
    });

    ipcMain.handle("ast:restructureClass", async (_event, payload) => {
      const { filePath, className, options } = payload || {};
      return await this.refactorer.restructureClass(filePath, className, options || {});
    });

    ipcMain.handle("ast:provideCodeActions", async (_event, payload) => {
      const result = await this.provider.provideCodeActions(payload || {});
      return result;
    });

    ipcMain.handle("ast:executeCodeAction", async (_event, payload) => {
      return await this.provider.executeCodeAction(payload || {});
    });

    ipcMain.handle("ast:listActions", async () => {
      return this.provider.listActions();
    });
  }

  getContext() {
    return {
      refactorer: this.refactorer,
      provider: this.provider,
    };
  }
}

module.exports = { AstIpcBridge };
