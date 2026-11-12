"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { handleChatKernel, stopChatKernel } = require("../runtime/chat-kernel-bridge");

test("DEMO 1: tarea agente completa ('crea status.txt y verifícalo con un comando') de principio a fin con eventos en orden", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo1-agent-"));
  const events = [];
  let callCount = 0;

  const mockCallChat = async ({ messages }) => {
    callCount += 1;
    const lastMsg = messages[messages.length - 1];

    if (callCount === 1) {
      return {
        text: "Voy a crear status.txt",
        toolCalls: [{
          id: "call_w1",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: "status.txt", content: "status: operational\n" })
          }
        }],
        usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 }
      };
    }

    if (callCount === 2) {
      assert.equal(lastMsg.role, "tool");
      return {
        text: "Ahora verifico el archivo con un comando",
        toolCalls: [{
          id: "call_c1",
          function: {
            name: "run_command",
            arguments: JSON.stringify({ command: "node -e \"console.log('STATUS_OK')\"" })
          }
        }],
        usage: { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 }
      };
    }

    if (callCount === 3) {
      assert.equal(lastMsg.role, "tool");
      return {
        text: "status.txt creado y verificado con éxito.",
        toolCalls: [],
        usage: { prompt_tokens: 60, completion_tokens: 10, total_tokens: 70 }
      };
    }

    throw new Error(`Llamada inesperada ${callCount}`);
  };

  const res = await handleChatKernel({
    message: "crea status.txt y verifícalo con un comando",
    projectRoot: tmpDir,
    apiKey: "test-key",
    model: "test-model",
    allowWrite: true,
    permissionMode: "full",
    fullAccess: true,
    planAuthorizedExecution: true,
    helpers: {
      callChat: mockCallChat
    },
    onProgress: (p) => {
      events.push(p);
    }
  });

  // 1. Verificación del resultado devuelto
  assert.equal(res.ok, true);
  assert.match(res.text, /status\.txt creado y verificado/);
  assert.equal(callCount, 3);

  // 2. Verificación de archivo en disco
  const createdContent = fs.readFileSync(path.join(tmpDir, "status.txt"), "utf8");
  assert.equal(createdContent, "status: operational\n");

  // 3. Verificación de orden de eventos en contrato
  const phases = events.map((e) => e.phase);
  assert.ok(phases.includes("tool"), "debe emitir eventos de fase tool");
  
  const writeRunning = events.findIndex((e) => e.phase === "tool" && e.name === "write_file" && e.stage === "running");
  const writeDone = events.findIndex((e) => e.phase === "tool" && e.name === "write_file" && e.stage === "done");
  const cmdRunning = events.findIndex((e) => e.phase === "tool" && e.name === "run_command" && e.stage === "running");
  const cmdDone = events.findIndex((e) => e.phase === "tool" && e.name === "run_command" && e.stage === "done");

  assert.ok(writeRunning !== -1, "write_file running debe existir");
  assert.ok(writeDone !== -1, "write_file done debe existir");
  assert.ok(cmdRunning !== -1, "run_command running debe existir");
  assert.ok(cmdDone !== -1, "run_command done debe existir");
  assert.ok(writeRunning < writeDone, "write_file running debe preceder a done");
  assert.ok(writeDone < cmdRunning, "write_file done debe preceder a run_command running");
  assert.ok(cmdRunning < cmdDone, "run_command running debe preceder a done");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DEMO 2: Detener a mitad de corrida cancela de verdad y no sigue llamando al proveedor", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo2-agent-"));
  let providerCalls = 0;

  const mockCallChat = async () => {
    providerCalls += 1;
    // Simular que el usuario detiene justo en el primer turno
    stopChatKernel();
    return {
      text: "Iniciando...",
      toolCalls: [{
        id: "call_long_1",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: "should_not_continue.txt", content: "data" })
        }
      }],
      usage: { total_tokens: 10 }
    };
  };

  const res = await handleChatKernel({
    message: "crea el archivo should_not_continue.txt y compila el proyecto",
    projectRoot: tmpDir,
    apiKey: "test-key",
    model: "test-model",
    allowWrite: true,
    permissionMode: "full",
    fullAccess: true,
    planAuthorizedExecution: true,
    helpers: {
      callChat: mockCallChat
    }
  });

  // El proveedor NO debe haber recibido llamadas subsiguientes
  assert.equal(providerCalls, 1, "el proveedor solo debe haberse llamado 1 vez antes de frenar");
  assert.ok(res.kind === "STOP" || String(res.text).includes("Detenido") || String(res.text).includes("Frené") || res.incomplete || !res.ok, "la corrida debe reportarse detenida");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DEMO 3: una tarea en solo-lectura no puede escribir", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo3-agent-"));
  let writeBlocked = false;

  const mockCallChat = async () => {
    return {
      text: "Intentando escribir en solo lectura",
      toolCalls: [{
        id: "call_w_readonly",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: "forbidden.txt", content: "illegal" })
        }
      }],
      usage: { total_tokens: 10 }
    };
  };

  const res = await handleChatKernel({
    message: "escribe en forbidden.txt",
    projectRoot: tmpDir,
    apiKey: "test-key",
    model: "test-model",
    allowWrite: false, // SOLO LECTURA
    permissionMode: "readonly",
    fullAccess: false,
    planAuthorizedExecution: false,
    // [EDITCORE-V492-1] Actualizado a propósito: desde la v4.9.2 la
    // superficie de la app NUNCA entrega un modo restrictivo al bridge
    // (acceso completo permanente, regla de Luis) — sin el opt-out, el
    // bridge normalizaría este turno a «full» y la escritura pasaría
    // (esa conducta nueva la prueba permisos-permanentes-v492). Esta
    // demo sigue probando lo suyo — que la COMPUERTA DEL KERNEL corta
    // una tarea en solo lectura de principio a fin — a través del
    // opt-out explícito que main reserva a sus corridas internas.
    respectRestrictiveMode: true,
    helpers: {
      callChat: mockCallChat
    },
    onProgress: (p) => {
      if (p.phase === "tool" && p.name === "write_file" && (p.ok === false || p.blocked === true)) {
        writeBlocked = true;
      }
    }
  });

  // El archivo NUNCA debe crearse en disco
  assert.equal(fs.existsSync(path.join(tmpDir, "forbidden.txt")), false, "el archivo no debe existir en disco");

  // La corrida debe reportar que el paso de escritura fue denegado o no aplicado
  const wroteStep = (res.steps || []).find((s) => s.name === "write_file");
  if (wroteStep) {
    assert.equal(wroteStep.ok, false, "el paso write_file no debe ser exitoso");
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DEMO 4: si el proveedor no acepta herramientas nativas, la ruta da error explícito, nunca éxito falso", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo4-agent-"));

  const mockCallChat = async () => {
    const error = new Error("400 Model does not support tools / function calling");
    error.status = 400;
    error.code = "TOOLS_UNSUPPORTED";
    throw error;
  };

  await assert.rejects(
    async () => {
      await handleChatKernel({
        message: "crea archivo",
        projectRoot: tmpDir,
        apiKey: "test-key",
        model: "test-model-no-tools",
        allowWrite: true,
        helpers: {
          callChat: mockCallChat
        }
      });
    },
    (err) => {
      assert.ok(err instanceof Error, "debe lanzar un Error explícito");
      assert.match(err.message, /tools|support|400/i, "debe contener el mensaje explícito del fallo");
      return true;
    }
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
