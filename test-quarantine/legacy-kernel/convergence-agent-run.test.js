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

  // 3. [FASE2-RUTA-UNICA] La verificación de ORDEN DE EVENTOS por
  // herramienta (phase "tool" running/done) se retira: era el flujo
  // de progreso del orquestador viejo. La ruta única emite por el
  // puente el heartbeat con la identidad de la corrida (contrato
  // afirmado en turno-chat-b7 B7-3a); el orden de ejecución aquí lo
  // prueban el propio guion (cada llamada afirma que la anterior
  // volvió como resultado) y el archivo verificado en disco.

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DEMO 2: Detener a mitad de corrida cancela de verdad y no sigue llamando al proveedor", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo2-agent-"));
  let providerCalls = 0;

  const mockCallChat = async ({ signal } = {}) => {
    providerCalls += 1;
    // [FASE2-RUTA-UNICA] El proveedor falso honra la señal como el
    // real: una llamada que nace abortada se rechaza al instante.
    // La primera devuelve la escritura TARDE (tras el Detener) a
    // propósito: la guarda del adaptador es la que debe cortarla.
    if (signal?.aborted) {
      throw Object.assign(new Error("La llamada nació abortada."), { name: "AbortError" });
    }
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

  // Tras el Detener no hay trabajo útil del proveedor: la llamada
  // que devolvió la escritura tarde y, como mucho, una segunda que
  // nació abortada y se rechazó al instante (así se comporta el
  // callChat real). Y la escritura tardía NO se aplicó.
  assert.ok(providerCalls <= 2, `el proveedor no siguió trabajando tras frenar (llamadas: ${providerCalls})`);
  assert.equal(fs.existsSync(path.join(tmpDir, "should_not_continue.txt")), false, "la escritura devuelta tras el Detener no se ejecutó");
  assert.ok(res.kind === "STOP" || String(res.text).includes("Detenido") || String(res.text).includes("Frené") || res.incomplete || !res.ok, "la corrida debe reportarse detenida");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DEMO 3 (ruta única): el modo solo-lectura YA NO alcanza al kernel — la protección vigente es el carril, no el permiso", async () => {
  // [REDELIMITADO A PROPÓSITO — FASE 2, v5.2.7] La DEMO original
  // probaba la compuerta del kernel viejo a través del opt-out
  // respectRestrictiveMode (reservado a las corridas internas del
  // Inspector): con él, un turno «readonly» no escribía. En la ruta
  // única esa compuerta NO EXISTE: el kernel nuevo no recibe modos
  // de permiso (su adaptador sirve siempre el set completo) y la
  // normalización del puente es la única palabra — acceso completo
  // permanente, la regla de producto de Luis. Lo que esta DEMO
  // afirma ahora es esa verdad, sin disfraz: ni con
  // respectRestrictiveMode un turno de ORDEN se frena por modo. La
  // protección que sí existe en el kernel nuevo es la de FORMA:
  // una pregunta o consulta jamás recibe herramientas de escritura
  // (carriles, batería kernel-nuevo-despacho).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo3-agent-"));
  const mockCallChat = async () => ({
    text: "Escribo el archivo.",
    toolCalls: [{
      id: "call_w_readonly",
      function: {
        name: "write_file",
        arguments: JSON.stringify({ path: "forbidden.txt", content: "illegal" })
      }
    }],
    usage: { total_tokens: 10 }
  });
  const script = [mockCallChat, async () => ({ text: "Listo.", toolCalls: [], usage: {} })];
  let llamada = 0;
  const res = await handleChatKernel({
    message: "escribe en forbidden.txt",
    projectRoot: tmpDir,
    apiKey: "test-key",
    model: "test-model",
    allowWrite: false,
    permissionMode: "readonly",
    fullAccess: false,
    planAuthorizedExecution: false,
    respectRestrictiveMode: true,
    helpers: {
      callChat: async (...args) => script[Math.min(llamada++, script.length - 1)](...args)
    }
  });
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(path.join(tmpDir, "forbidden.txt")), true, "declarado: en la ruta única el modo guardado no frena una ORDEN (acceso completo permanente)");
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
