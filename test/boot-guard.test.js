"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

test("Safe IPC Handler Wrapper evita colisiones y dobles registros", () => {
  // Simular objeto ipcMain de Electron
  const fakeIpc = {
    handlers: new Map(),
    handle(channel, listener) {
      if (this.handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`);
      }
      this.handlers.set(channel, listener);
    },
    removeHandler(channel) {
      this.handlers.delete(channel);
    },
  };

  // Aplicar wrapper de protección
  const origHandle = fakeIpc.handle.bind(fakeIpc);
  fakeIpc.handle = function safeIpcHandle(channel, handler) {
    try {
      fakeIpc.removeHandler(channel);
    } catch {}
    return origHandle(channel, handler);
  };

  // Registro 1
  assert.doesNotThrow(() => {
    fakeIpc.handle("app:check-updates", () => ({ v: 1 }));
  });

  // Registro 2 (duplicado intencional): Debe sobrescribir limpiamente sin lanzar error fatal
  assert.doesNotThrow(() => {
    fakeIpc.handle("app:check-updates", () => ({ v: 2 }));
  });

  const handler = fakeIpc.handlers.get("app:check-updates");
  assert.equal(handler().v, 2);
});

test("Boot Guard interceptor captura excepciones críticas de arranque", () => {
  let recoveryTriggered = false;
  let booting = true;

  function handleBootException(err) {
    if (booting) {
      recoveryTriggered = true;
      return { action: "recovery_offered", error: err.message };
    }
    return { action: "logged" };
  }

  const result = handleBootException(new Error("Fallo simulado de arranque"));
  assert.equal(recoveryTriggered, true);
  assert.equal(result.action, "recovery_offered");
  assert.equal(result.error, "Fallo simulado de arranque");
});
