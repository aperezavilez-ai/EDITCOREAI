"use strict";

// [EDITCORE-INTEGRAL-B7] Bloque 7 — «El turno pertenece a su chat, y la
// cola tiene plazo». Pruebas de COMPORTAMIENTO con fakes/costuras
// inyectadas (patrón de test/publicacion-verificada.test.js), sin red
// ni CLI. Cubren, en las costuras del kernel y del bridge:
//  (1) dos handleChat concurrentes con el primero bloqueado en el
//      proveedor: el segundo, con plazo de cola corto inyectado,
//      resuelve con el resultado HONESTO de cola (no cuelga, no se
//      ejecuta) y el primero sigue intacto y completa después.
//  (2) cancelar el runId EN COLA ⇒ su promesa resuelve cancelada y
//      el que corre no se entera; cancelar el runId EN CURSO ⇒ solo
//      su señal se aborta y el que esperaba detrás corre después.
//  (3) el progreso de un turno lleva su runId de principio a fin por
//      el bridge (ruta chat): ningún evento sale con runId vacío.
//  (4) el resolvedor puro de destino: turno completado con un chat
//      activo distinto ⇒ el destino de persistencia es el chat de
//      ORIGEN.
// La serialización no se toca: un solo orquestador, una cadena (las
// pruebas 1 y 2 solo pasan si el segundo NUNCA corre en paralelo).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b7-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmp, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
const projectRoot = path.join(tmp, "proyecto");
fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo" }));
fs.writeFileSync(path.join(projectRoot, "src", "App.tsx"), "export const App = () => null;\n");

const {
  handleChat,
  cancelChatRun,
  listChatRuns,
  QUEUE_TIMEOUT_MS,
} = require("../editcore-chat-kernel/index");
const { handleChatKernel, KERNEL_TIMEOUT_MS } = require("../runtime/chat-kernel-bridge");
const ownership = require("../runtime/chat-turn-ownership");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function pendingProbe(promise, ms = 40) {
  return Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise((res) => setTimeout(() => res("pending"), ms)),
  ]);
}

const CHAT_MSG = "hola, ¿me ayudas con una duda rápida?";

// ---------- (d) el plazo de cola declarado es menor que el total ----------

test("B7-0: el plazo de cola declarado (120 s) es mucho menor que el plazo total del bridge (60 min)", () => {
  assert.equal(QUEUE_TIMEOUT_MS, 120_000);
  assert.equal(KERNEL_TIMEOUT_MS, 60 * 60 * 1000);
  assert.ok(QUEUE_TIMEOUT_MS < KERNEL_TIMEOUT_MS, "esperar en cola no consume el plazo de ejecución");
});

// ---------- (1) cola con plazo: el segundo no cuelga ni se ejecuta ----------

test("B7-1: primero bloqueado en el proveedor ⇒ el segundo resuelve con el resultado honesto de cola y el primero completa después", async () => {
  const gate = deferred();
  let firstCalls = 0;
  let secondCalls = 0;

  const firstPromise = handleChat({
    runId: "b7-t1-first",
    chatId: "chat-a",
    message: CHAT_MSG,
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    helpers: {
      callChat: async () => {
        firstCalls += 1;
        return gate.promise;
      },
    },
  });

  const second = await handleChat({
    runId: "b7-t1-second",
    chatId: "chat-b",
    message: CHAT_MSG,
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    queueTimeoutMs: 80,
    helpers: {
      callChat: async () => {
        secondCalls += 1;
        return { text: "no debería ejecutarse", toolCalls: [], usage: {} };
      },
    },
  });

  assert.equal(second.queued, true, "el segundo resolvió como EN COLA, no colgado ni ejecutado");
  assert.equal(second.queueTimeout, true);
  assert.equal(second.kind, "QUEUED");
  assert.equal(second.runId, "b7-t1-second", "el resultado de cola lleva la identidad de SU corrida");
  assert.equal(second.chatId, "chat-b");
  assert.match(second.text, /sigue en cola/, "la burbuja del segundo dice la verdad: sigue en cola");
  assert.match(second.text, /no se ejecutó/i);
  assert.equal(secondCalls, 0, "el turno vencido en cola NUNCA llegó al proveedor");
  assert.equal(await pendingProbe(firstPromise), "pending", "el primero sigue intacto, corriendo");

  gate.resolve({ text: "Respuesta del primer turno.", toolCalls: [], usage: {} });
  const first = await firstPromise;
  assert.equal(firstCalls, 1);
  assert.match(first.text, /Respuesta del primer turno/);
  assert.equal(first.runId, "b7-t1-first", "el resultado del primero lleva su runId");
});

// ---------- (2a) cancelar en cola ----------

test("B7-2a: cancelar el runId EN COLA ⇒ su promesa resuelve cancelada y el que corre no se entera", async () => {
  const gate = deferred();
  let firstCalls = 0;
  let secondCalls = 0;

  const firstPromise = handleChat({
    runId: "b7-t2-first",
    chatId: "chat-a",
    message: CHAT_MSG,
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    helpers: {
      callChat: async () => {
        firstCalls += 1;
        return gate.promise;
      },
    },
  });

  const secondPromise = handleChat({
    runId: "b7-t2-second",
    chatId: "chat-b",
    message: CHAT_MSG,
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    queueTimeoutMs: 0, // sin plazo: solo la cancelación lo saca de la cola
    helpers: {
      callChat: async () => {
        secondCalls += 1;
        return { text: "no debería ejecutarse", toolCalls: [], usage: {} };
      },
    },
  });

  // Esperar a que la segunda corrida exista registrada como en cola.
  for (let i = 0; i < 50 && !listChatRuns().some((r) => r.runId === "b7-t2-second"); i += 1) {
    await new Promise((res) => setTimeout(res, 10));
  }
  assert.ok(listChatRuns().some((r) => r.runId === "b7-t2-second" && r.state === "queued"), "la segunda corrida está registrada EN COLA");

  assert.equal(cancelChatRun("b7-t2-second"), true, "cancelar una corrida en cola la encuentra");
  const second = await secondPromise;
  assert.equal(second.cancelled, true);
  assert.equal(second.queuedCancelled, true, "se declara cancelada EN COLA");
  assert.equal(second.kind, "STOP");
  assert.equal(second.runId, "b7-t2-second");
  assert.equal(secondCalls, 0, "la corrida cancelada en cola nunca llegó al proveedor");

  assert.equal(await pendingProbe(firstPromise), "pending", "el que corre NO se enteró de la cancelación ajena");
  gate.resolve({ text: "El primero terminó bien.", toolCalls: [], usage: {} });
  const first = await firstPromise;
  assert.equal(firstCalls, 1);
  assert.match(first.text, /El primero terminó bien/);
  assert.notEqual(first.cancelled, true);
});

// ---------- (2b) cancelar en curso: solo su señal ----------

test("B7-2b: cancelar el runId EN CURSO ⇒ solo esa corrida se detiene; la que esperaba detrás corre después", async () => {
  let cancelResult = null;
  let runnerCalls = 0;

  const runnerPromise = handleChat({
    runId: "b7-t3-runner",
    chatId: "chat-a",
    message: "crea el archivo no-debe-crearse.txt en la raiz del proyecto",
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    planAuthorizedExecution: true,
    helpers: {
      callChat: async () => {
        runnerCalls += 1;
        // Detener quirúrgico de ESTA corrida mientras el proveedor
        // «piensa»: el aborto llega antes de que devuelva la llamada.
        setTimeout(() => { cancelResult = cancelChatRun("b7-t3-runner"); }, 30);
        await new Promise((res) => setTimeout(res, 90));
        return {
          text: "Voy a crear el archivo.",
          toolCalls: [{ id: "call_w", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "no-debe-crearse.txt", content: "x\n" }) } }],
          usage: {},
        };
      },
    },
  });

  const behindPromise = handleChat({
    runId: "b7-t3-behind",
    chatId: "chat-b",
    message: CHAT_MSG,
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    queueTimeoutMs: 0,
    helpers: {
      callChat: async () => ({ text: "Respuesta del turno que esperaba.", toolCalls: [], usage: {} }),
    },
  });

  const runner = await runnerPromise;
  assert.equal(cancelResult, true, "la corrida en curso se encontró por su runId");
  assert.equal(runnerCalls, 1, "el proveedor no recibió más llamadas tras el Detener de esa corrida");
  assert.ok(
    runner.kind === "STOP" || /detenid|frené/i.test(String(runner.text || "")),
    `la corrida cancelada se reporta detenida (kind=${runner.kind})`,
  );
  assert.equal(fs.existsSync(path.join(projectRoot, "no-debe-crearse.txt")), false, "la herramienta de la corrida cancelada no se ejecutó");

  const behind = await behindPromise;
  assert.match(behind.text, /Respuesta del turno que esperaba/, "la corrida en cola NO fue cancelada: corrió al liberarse la cadena");
  assert.notEqual(behind.cancelled, true);
  assert.equal(behind.runId, "b7-t3-behind");
});

// ---------- (3) progreso con runId por el bridge (ruta chat) ----------

test("B7-3a: bridge con runId del renderer ⇒ TODOS los eventos de progreso y el resultado llevan ese runId", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b7-prog-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
  const events = [];
  const script = [
    { text: "", toolCalls: [{ id: "call_w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "nota-b7.txt", content: "hola\n" }) } }], usage: {} },
    { text: "Listo: cree nota-b7.txt con el contenido pedido.", toolCalls: [], usage: {} },
  ];
  const out = await handleChatKernel({
    message: "AUTORIZACION DE EJECUCION: crea el archivo nota-b7.txt con el contenido del plan presentado al usuario.",
    history: [
      { role: "user", content: "crea un archivo nota-b7.txt" },
      { role: "assistant", content: "Voy a crear nota-b7.txt. ¿Procedo?" },
    ],
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    allowWrite: true,
    permissionMode: "step",
    fullAccess: false,
    planAuthorized: true,
    runId: "b7-progress-run",
    chatId: "chat-b7-1",
    helpers: { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } },
    onProgress: (p) => events.push(p),
  });

  assert.equal(out.ok, true);
  assert.equal(out.runId, "b7-progress-run", "el resultado del bridge lleva el runId de la corrida");
  assert.ok(events.length > 0, "hubo eventos de progreso");
  for (const event of events) {
    assert.equal(event.runId, "b7-progress-run", `ningún evento sale con runId vacío o ajeno (fase=${event.phase})`);
    assert.equal(event.chatId, "chat-b7-1", "el progreso también lleva el chat de origen");
  }
  assert.ok(events.some((e) => e.phase === "tool" && e.name === "write_file"), "el progreso real del turno fluyó por la misma ruta");
});

test("B7-3b: bridge sin runId ⇒ lo genera una vez y lo estampa en cada evento y en el resultado (ruta casual incluida)", async () => {
  const events = [];
  const out = await handleChatKernel({
    message: "gracias",
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    helpers: {},
    onProgress: (p) => events.push(p),
  });
  assert.ok(out.runId, "el resultado lleva un runId generado, nunca vacío");
  assert.ok(events.length > 0, "la ruta casual también emite progreso identificado");
  for (const event of events) {
    assert.equal(event.runId, out.runId, "todos los eventos comparten el runId de la corrida");
  }
});

// ---------- (4) destino de persistencia: el chat de origen ----------

test("B7-4: turno completado con OTRO chat activo ⇒ el destino es el chat de ORIGEN; pintar, solo si el feed visible es el de origen", () => {
  const projects = [
    {
      id: "p1",
      chats: [
        { id: "chat-a", messages: [] },
        { id: "chat-b", messages: [] },
      ],
    },
    { id: "p2", chats: [{ id: "chat-c", messages: [] }] },
  ];

  // El usuario envió en chat-a y al terminar está viendo chat-b:
  const dest = ownership.resolveChatDestination(projects, {
    originProjectId: "p1",
    originChatId: "chat-a",
    activeProjectId: "p1",
    activeChatId: "chat-b",
  });
  assert.equal(dest.chatId, "chat-a", "la respuesta se persiste en el chat que la pidió, no en el activo al terminar");
  assert.equal(dest.projectId, "p1");
  assert.equal(dest.isOrigin, true);
  assert.equal(dest.chat, projects[0].chats[0], "el destino es el objeto del chat de origen");

  // Origen en otro proyecto: también manda el origen.
  const cross = ownership.resolveChatDestination(projects, {
    originProjectId: "p1",
    originChatId: "chat-a",
    activeProjectId: "p2",
    activeChatId: "chat-c",
  });
  assert.equal(cross.chatId, "chat-a");
  assert.equal(cross.projectId, "p1");

  // Respaldo declarado: el chat de origen ya no existe → el activo.
  const gone = ownership.resolveChatDestination(projects, {
    originProjectId: "p1",
    originChatId: "chat-borrado",
    activeProjectId: "p1",
    activeChatId: "chat-b",
  });
  assert.equal(gone.chatId, "chat-b");
  assert.equal(gone.isOrigin, false);

  assert.equal(
    ownership.resolveTargetChatId({ originChatId: "chat-a", activeChatId: "chat-b", chatIds: ["chat-a", "chat-b"] }),
    "chat-a",
  );
  assert.equal(
    ownership.resolveTargetChatId({ originChatId: "chat-borrado", activeChatId: "chat-b", chatIds: ["chat-a", "chat-b"] }),
    "chat-b",
  );

  // Pintado: solo si el feed visible es el del origen.
  assert.equal(ownership.isOriginFeedVisible({ originChatId: "chat-a", activeChatId: "chat-b" }), false);
  assert.equal(ownership.isOriginFeedVisible({ originChatId: "chat-a", activeChatId: "chat-a" }), true);
  assert.equal(
    ownership.isOriginFeedVisible({ originProjectId: "p1", originChatId: "chat-a", activeProjectId: "p2", activeChatId: "chat-a" }),
    false,
    "mismo id de chat en otro proyecto tampoco es el feed de origen",
  );

  // appendThinking: una tarjeta de OTRA corrida jamás se asienta;
  // la de la propia corrida, sí; las legadas entre sí, como siempre.
  assert.equal(ownership.shouldSettleCardOnNewThinking({ runId: "run-a" }, { runId: "run-b" }), false);
  assert.equal(ownership.shouldSettleCardOnNewThinking({ runId: "run-a" }, { runId: "run-a" }), true);
  assert.equal(ownership.shouldSettleCardOnNewThinking({ runId: "run-a" }, {}), false, "una tarjeta identificada no la asienta una creación sin identidad");
  assert.equal(ownership.shouldSettleCardOnNewThinking({}, {}), true);
});
