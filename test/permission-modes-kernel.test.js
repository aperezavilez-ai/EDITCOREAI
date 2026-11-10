"use strict";

// Regresión: el modo "Pregunta antes de escribir o ejecutar" (step) NO se
// respetaba en vivo. handle() pasaba authorizedFromPending: canWrite a
// runModelTask, lo que pre-autorizaba toda corrida step: el motor calculaba
// acceso completo a partir de ese flag y escribía sin pedir confirmación.
// La autorización sin preguntar solo puede venir de: Acceso completo, un
// plan autorizado que llega como tal, o un mensaje de aprobación del
// usuario en ese turno ("procede").

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

async function captureRun(input) {
  const orch = new ChatOrchestrator();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-perm-"));
  let captured = null;
  await orch.handle({
    message: "crea un archivo prueba.txt en la raíz del proyecto",
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "claude-haiku-4.5",
    history: [],
    runModelTaskFn: async (opts) => {
      captured = opts;
      return { kind: "EXECUTE", text: "capturado", steps: [] };
    },
    ...input,
  });
  assert.ok(captured, "runModelTask debió ser invocado");
  return captured;
}

test("step sin autorización: NO se pre-autoriza la escritura", async () => {
  const opts = await captureRun({
    permissionMode: "step",
    allowWrite: true,
    fullAccess: false,
    planAuthorizedExecution: false,
  });
  assert.equal(opts.authorizedFromPending, false);
  assert.equal(opts.planAuthorizedExecution, false);
  assert.equal(opts.permissionMode, "step");
});

test("step con plan autorizado: la escritura queda autorizada", async () => {
  const opts = await captureRun({
    permissionMode: "step",
    allowWrite: true,
    fullAccess: false,
    planAuthorizedExecution: true,
  });
  assert.equal(opts.authorizedFromPending, true);
  assert.equal(opts.planAuthorizedExecution, true);
});

test("step + el usuario responde 'procede': la escritura queda autorizada", async () => {
  const orch = new ChatOrchestrator();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-perm-"));
  let captured = null;
  await orch.handle({
    message: "procede",
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "claude-haiku-4.5",
    history: [
      { role: "user", content: "crea un archivo prueba.txt en la raíz del proyecto" },
      { role: "assistant", content: "Voy a crear prueba.txt. ¿Procedo?" },
    ],
    permissionMode: "step",
    allowWrite: true,
    fullAccess: false,
    planAuthorizedExecution: false,
    runModelTaskFn: async (opts) => {
      captured = opts;
      return { kind: "EXECUTE", text: "capturado", steps: [] };
    },
  });
  assert.ok(captured, "runModelTask debió ser invocado");
  assert.equal(captured.authorizedFromPending, true);
});

test("solo lectura: allowWrite llega en false al motor", async () => {
  const opts = await captureRun({
    permissionMode: "readonly",
    allowWrite: false,
    fullAccess: false,
    planAuthorizedExecution: false,
  });
  assert.equal(opts.allowWrite, false);
  assert.equal(opts.authorizedFromPending, false);
});

test("sin modo declarado (uso directo del kernel): se conserva el comportamiento histórico", async () => {
  const opts = await captureRun({
    allowWrite: true,
    fullAccess: false,
    planAuthorizedExecution: false,
  });
  assert.equal(opts.authorizedFromPending, true);
  assert.equal(opts.allowWrite, true);
});

test("acceso completo: la escritura queda autorizada", async () => {
  const opts = await captureRun({
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    planAuthorizedExecution: false,
  });
  assert.equal(opts.authorizedFromPending, true);
  assert.equal(opts.allowWrite, true);
});
