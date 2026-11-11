"use strict";

// [EDITCORE-INTEGRAL-B10] Semilla de aceptación del KERNEL (el motor
// que el usuario sí ejecuta), fuera de la suite unitaria: NO forma
// parte de `npm test`. Es el embrión de la aceptación de extremo a
// extremo que un día sustituya a la aceptación headless del adaptador
// en cuarentena (runtime/editcore-claude-adapter.js, ver
// test-quarantine/claude-adapter/README.md).
//
// Qué ejercita, sin red ni Electron:
//   renderer-less → runtime/chat-kernel-bridge.js (handleChatKernel,
//   el mismo camino que main.js usa) → editcore-chat-kernel
//   (handleChat → ChatOrchestrator) con un proveedor FALSO inyectado
//   por la costura helpers.callChat y un proyecto temporal real:
//     Turno 1: el modelo pide write_file y el kernel crea un archivo
//              REAL en disco (se comprueba el contenido en el FS).
//     Turno 2: en el MISMO hilo, sin nombrar el archivo en el prompt,
//              el modelo solo puede responder bien si el expediente
//              del kernel le recuerda el turno anterior; el proveedor
//              falso busca esa evidencia en su entrada y el script
//              verifica la respuesta.
//
// Uso: node scripts/acceptance-kernel.js   (exit 0 = pasa, 1 = falla)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-accept-kernel-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmp, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
const projectRoot = path.join(tmp, "proyecto");
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "aceptacion" }));

const { handleChatKernel, buildKernelHelpers } = require("../runtime/chat-kernel-bridge");

const FILE = "notas.txt";
const CONTENT = "El hero usa la foto hero.jpg";
let turn = 0;
let callsInTurn = 0;
let turn2SawEvidence = false;

async function fakeProvider(args) {
  callsInTurn += 1;
  if (turn === 1) {
    if (callsInTurn === 1) {
      return {
        text: "",
        toolCalls: [{
          id: "acc-1",
          type: "function",
          function: { name: "write_file", arguments: JSON.stringify({ path: FILE, content: CONTENT }) },
        }],
        usage: {},
      };
    }
    return { text: `Listo: creé ${FILE} con la nota del hero.`, toolCalls: [], usage: {} };
  }
  // Turno 2: la única forma honesta de acertar es que el contexto que
  // el kernel entrega al proveedor recuerde el archivo y su contenido.
  const seen = JSON.stringify(args || {});
  turn2SawEvidence = seen.includes(FILE) && seen.includes("hero.jpg");
  return {
    text: turn2SawEvidence
      ? `En el turno anterior creé ${FILE} y menciona la foto hero.jpg.`
      : "No recuerdo qué archivo se creó en el turno anterior.",
    toolCalls: [],
    usage: {},
  };
}

function fail(msg) {
  console.error(`[acceptance-kernel] FALLO: ${msg}`);
  process.exitCode = 1;
}

(async () => {
  const helpers = buildKernelHelpers({ callChat: fakeProvider });
  const base = {
    projectRoot,
    apiBaseUrl: "https://example.invalid/v1",
    apiKey: "sk-test",
    model: "test-model",
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    threadId: "acceptance-thread",
    chatId: "acceptance-chat",
    helpers,
    history: [],
  };

  turn = 1; callsInTurn = 0;
  const out1 = await handleChatKernel({
    ...base,
    runId: "acceptance-run-1",
    message: `crea el archivo ${FILE} con este texto: ${CONTENT}`,
  });
  const onDisk = fs.existsSync(path.join(projectRoot, FILE))
    ? fs.readFileSync(path.join(projectRoot, FILE), "utf8")
    : "";
  if (!onDisk.includes("hero.jpg")) {
    fail(`el turno 1 no creó ${FILE} en disco con su contenido (leído: ${JSON.stringify(onDisk).slice(0, 120)})`);
    return;
  }
  console.log(`[acceptance-kernel] turno 1 OK: ${FILE} creado en disco vía bridge→kernel (texto del turno: ${String(out1.text || "").slice(0, 80)}…)`);

  turn = 2; callsInTurn = 0;
  const out2 = await handleChatKernel({
    ...base,
    runId: "acceptance-run-2",
    message: "¿qué archivo creaste en el turno anterior y qué foto menciona?",
    history: [
      { role: "user", content: `crea el archivo ${FILE} con este texto: ${CONTENT}` },
      { role: "assistant", content: String(out1.text || "") },
    ],
  });
  if (!turn2SawEvidence) {
    fail("el turno 2 no recibió evidencia del turno 1 en su contexto (el expediente no recordó el archivo)");
    return;
  }
  if (!String(out2.text || "").includes(FILE)) {
    fail(`la respuesta del turno 2 no nombra ${FILE}: ${String(out2.text || "").slice(0, 160)}`);
    return;
  }
  console.log(`[acceptance-kernel] turno 2 OK: el hilo recordó ${FILE} desde el expediente del kernel`);
  console.log("[acceptance-kernel] PASS");
})().catch((error) => {
  console.error(`[acceptance-kernel] FALLO: ${error?.stack || error}`);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
