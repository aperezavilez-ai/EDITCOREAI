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
//
// [REDELIMITADO A PROPÓSITO — FASE 2, v5.2.7] El kernel nuevo es la
// ruta ÚNICA y la entrada (editcore-chat-kernel/index.js) cambió de
// mecanismo: ya no hay cola con plazo ni fusión steering en la
// entrada (steerChat se declara no cableado: el carril paralelo del
// kernel nuevo existe como módulo, no como entrada), y el registro
// de corridas es por AbortController, sin listChatRuns. Las pruebas
// 1, 2a, 2b y 3a se reescriben contra el contrato NUEVO, que es el
// que Luis juzga en vivo: (1) el segundo turno ESPERA en cadena y
// corre DESPUÉS como turno propio — nunca en paralelo, nunca
// descartado, nunca fundido en silencio; (2) cancelar por runId
// funciona en cadena y en curso, y Detener corta también entre el
// proveedor y la herramienta; (3) la identidad (runId/chatId) viaja
// en el resultado y en el progreso del puente, cuya superficie en
// la ruta nueva es el heartbeat. Las pruebas 0, 3b y 4 no cambian.

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
  isChatRunning,
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

test("B7-0: las constantes de plazo declaradas se conservan (QUEUE_TIMEOUT_MS hoy es compatibilidad del puente)", () => {
  // [FASE2] La cola con plazo ya no existe en la ruta única; la
  // constante se conserva porque el puente la re-exporta y su
  // relación con el plazo total sigue siendo la declarada.
  assert.equal(QUEUE_TIMEOUT_MS, 120_000);
  assert.equal(KERNEL_TIMEOUT_MS, 60 * 60 * 1000);
  assert.ok(QUEUE_TIMEOUT_MS < KERNEL_TIMEOUT_MS, "esperar en cola no consume el plazo de ejecución");
});

// ---------- (1) cola con plazo: el segundo no cuelga ni se PIERDE ----------

test("B7-1: primero bloqueado en el proveedor ⇒ el segundo ESPERA en cadena (no corre en paralelo ni se descarta) y corre después como turno propio", async () => {
  // [REDELIMITADO A PROPÓSITO — FASE 2, v5.2.7] La versión anterior
  // afirmaba la fusión steering de la entrada vieja (B1b): al
  // vencer el plazo de cola, la instrucción se fundía en el turno
  // en curso. En la ruta única esa fusión NO existe en la entrada
  // (declarado en index.js: steerChat devuelve accepted:false; el
  // carril paralelo es un módulo aún no cableado). El contrato que
  // esta prueba afirma ahora es el de la cadena nueva, que conserva
  // lo que B7 protegía — serialización e identidad — sin inventar
  // la fusión: el segundo no corre en paralelo, no se descarta y
  // no caduca; espera y corre DESPUÉS, como turno propio, con su
  // proveedor y su runId.
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

  const secondPromise = handleChat({
    runId: "b7-t1-second",
    chatId: "chat-b",
    message: "agrega también un pie de página con el año al final del sitio",
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    helpers: {
      callChat: async () => {
        secondCalls += 1;
        return { text: "Respuesta del segundo turno.", toolCalls: [], usage: {} };
      },
    },
  });

  assert.equal(await pendingProbe(secondPromise), "pending", "el segundo ESPERA: no corre en paralelo con el primero");
  assert.equal(secondCalls, 0, "mientras el primero corre, el segundo no ha llegado al proveedor");
  assert.equal(await pendingProbe(firstPromise), "pending", "el primero sigue intacto, corriendo");
  assert.equal(isChatRunning(), true, "hay corridas vivas registradas");

  gate.resolve({ text: "Respuesta del primer turno.", toolCalls: [], usage: {} });
  const first = await firstPromise;
  assert.equal(firstCalls, 1);
  assert.match(first.text, /Respuesta del primer turno/);
  assert.equal(first.runId, "b7-t1-first", "el resultado del primero lleva su runId");

  const second = await secondPromise;
  assert.equal(secondCalls, 1, "al liberarse la cadena, el segundo corrió como turno propio");
  assert.match(second.text, /Respuesta del segundo turno/, "su respuesta es la SUYA, no un aviso de fusión ni de descarte");
  assert.equal(second.runId, "b7-t1-second", "el resultado lleva la identidad de SU corrida");
});

// ---------- (2a) cancelar en cola ----------

test("B7-2a: cancelar el runId EN CADENA (aún no arranca) ⇒ su promesa resuelve STOP sin llegar al proveedor y el que corre no se entera", async () => {
  // [REDELIMITADO A PROPÓSITO — FASE 2, v5.2.7] Sin cola ni
  // listChatRuns: en la ruta única la corrida se registra al entrar
  // (su AbortController existe desde handleChat) y la cadena la
  // arranca después; cancelarla en ese intervalo resuelve STOP sin
  // tocar al proveedor. La forma STOP de la entrada lleva
  // kind/incomplete (el puente la traduce a cancelled en su
  // resultado); queuedCancelled era un dato de la cola vieja.
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
    message: "agrega un pie de página con el año al final del sitio",
    projectRoot,
    apiBaseUrl: "https://proxy.example.test/v1",
    apiKey: "k",
    model: "m",
    helpers: {
      callChat: async () => {
        secondCalls += 1;
        return { text: "no debería ejecutarse", toolCalls: [], usage: {} };
      },
    },
  });

  assert.equal(cancelChatRun("b7-t2-second"), true, "cancelar una corrida en cadena la encuentra por su runId");
  assert.equal(await pendingProbe(firstPromise), "pending", "el que corre NO se enteró de la cancelación ajena");

  gate.resolve({ text: "El primero terminó bien.", toolCalls: [], usage: {} });
  const first = await firstPromise;
  assert.equal(firstCalls, 1);
  assert.match(first.text, /El primero terminó bien/);
  assert.notEqual(first.kind, "STOP");

  const second = await secondPromise;
  assert.equal(second.kind, "STOP", "la corrida cancelada en cadena resuelve detenida");
  assert.equal(second.incomplete, true);
  assert.equal(second.runId, "b7-t2-second");
  assert.equal(secondCalls, 0, "la corrida cancelada en cadena nunca llegó al proveedor");
});

// ---------- (2b) cancelar en curso: solo su señal ----------

test("B7-2b: cancelar el runId EN CURSO ⇒ solo esa corrida se detiene (y su herramienta NO se ejecuta); la que esperaba detrás corre después", async () => {
  // [REDELIMITADO A PROPÓSITO — FASE 2, v5.2.7] El fake reproduce el
  // riesgo real que la ruta única cierra: un proveedor LENTO que
  // ignora la señal y devuelve la llamada de escritura DESPUÉS del
  // Detener. El kernel viejo lo cortaba en el orquestador; el nuevo
  // lo corta en el adaptador (la señal abortada ⇒ la herramienta no
  // se ejecuta) y la siguiente llamada al proveedor nace abortada y
  // se rechaza al instante, como hace el callChat real. Por eso el
  // conteo es 2 (la devuelta tarde + la rechazada al instante) y no
  // 1 como en la versión vieja de esta prueba.
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
    helpers: {
      callChat: async (args) => {
        runnerCalls += 1;
        if (args?.signal?.aborted) {
          throw Object.assign(new Error("La llamada nació abortada."), { name: "AbortError" });
        }
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
    helpers: {
      callChat: async () => ({ text: "Respuesta del turno que esperaba.", toolCalls: [], usage: {} }),
    },
  });

  const runner = await runnerPromise;
  assert.equal(cancelResult, true, "la corrida en curso se encontró por su runId");
  assert.equal(runner.kind, "STOP", "la corrida cancelada se reporta detenida");
  assert.equal(fs.existsSync(path.join(projectRoot, "no-debe-crearse.txt")), false, "la herramienta devuelta TRAS el Detener no se ejecutó");
  assert.ok(runnerCalls <= 2, `tras el Detener no hubo trabajo útil del proveedor (llamadas: ${runnerCalls})`);

  const behind = await behindPromise;
  assert.match(behind.text, /Respuesta del turno que esperaba/, "la corrida en cadena NO fue cancelada: corrió al liberarse la cadena");
  assert.notEqual(behind.kind, "STOP");
  assert.equal(behind.runId, "b7-t3-behind");
});

// ---------- (3) progreso con runId por el bridge (ruta chat) ----------

test("B7-3a: bridge con runId del renderer ⇒ el progreso (heartbeat) y el resultado llevan ese runId y su chatId", async () => {
  // [REDELIMITADO A PROPÓSITO — FASE 2, v5.2.7] La versión anterior
  // afirmaba eventos de progreso POR HERRAMIENTA (phase: "tool")
  // del orquestador viejo. La ruta única no emite ese flujo por el
  // puente: su superficie de progreso es el heartbeat de 5 s, que
  // pasa por la MISMA puerta (emitProgress) que estampa runId y
  // chatId en cada evento. El contrato de identidad — que es lo que
  // B7 protege: ningún evento sin identidad o con identidad ajena —
  // se afirma igual; el proveedor falso espera al primer heartbeat
  // antes de responder para que el flujo exista.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b7-prog-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
  const events = [];
  const out = await handleChatKernel({
    message: "¿qué hace este proyecto?",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    runId: "b7-progress-run",
    chatId: "chat-b7-1",
    helpers: {
      callChat: async () => {
        for (let i = 0; i < 100 && !events.some((e) => e.phase === "heartbeat"); i += 1) {
          await new Promise((res) => setTimeout(res, 100));
        }
        return { text: "Es un proyecto de demostración.", toolCalls: [], usage: {} };
      },
    },
    onProgress: (p) => events.push(p),
  });

  assert.equal(out.ok, true);
  assert.equal(out.runId, "b7-progress-run", "el resultado del bridge lleva el runId de la corrida");
  assert.ok(events.length > 0, "hubo eventos de progreso (heartbeat)");
  for (const event of events) {
    assert.equal(event.runId, "b7-progress-run", `ningún evento sale con runId vacío o ajeno (fase=${event.phase})`);
    assert.equal(event.chatId, "chat-b7-1", "el progreso también lleva el chat de origen");
  }
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
