"use strict";

// Batería ÍTEM 3 del plan de auditoría — EN TURNOS EXECUTE, EL MAPA
// ES CONTEXTO, NO VEREDICTO.
// Defecto probado (B19): en turnos EXECUTE el bloque del Mapa entra
// como tier ESENCIAL con su cabecera de autoridad («manda sobre
// relatos viejos; si algo de aquí contradice el historial, vale
// esto», editcore-chat-kernel/orientation-map.js, buildMapBlock) y
// ninguna compuerta contrasta con el estado real del repo: el agente
// puede cerrar una orden apoyándose en el Mapa («ya consta como
// hecha») sin mirar git. Sitios: orientation-map.js (cabecera) y
// orchestrator.js (inyección del bloque en runModelTask y
// dossierDedupeMap solo-EXECUTE).
// La corrección prescrita (mínima, solo-EXECUTE):
//  (a) en turnos EXECUTE la cabecera del bloque Mapa se emite SIN la
//      cláusula de autoridad (el Mapa orienta; no sentencia el
//      estado del repo); la ruta ASK conserva la cabecera actual
//      intacta, byte a byte (el carril de orientación está blindado);
//  (b) cuando la intención del turno es de mutación/publicación
//      (hasMutationIntent, la única fuente del léxico), el kernel
//      añade al contexto un hecho determinista de git calculado en
//      la apertura (rama, cambios sin commitear sí/no, último
//      commit), con el patrón de los demás hechos de apertura del
//      kernel (función determinista fail-open junto a
//      buildConnectionsBlock/buildBrainContextBlock): si git falla
//      o el proyecto no es repo, el hecho se omite sin romper el
//      turno.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-item3-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
// La capa USUARIO del Mapa vive en ~/.editcore: HOME temporal.
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const orientationMap = require("../editcore-chat-kernel/orientation-map");

const BASE_ARGS = {
  apiKey: ["sk", "fake", "item3"].join("-"),
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });
const CLAUSULA_AUTORIDAD = "manda sobre relatos viejos";

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(tmpBase, "proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// El mismo mecanismo de siembra que usan las baterías de orientación
// existentes (orientacion-ask-v511): asientos reales del Mapa vía
// orientation-map (openMapFront escribe a través del expediente).
function seedMap(root) {
  orientationMap.openMapFront(root, "Publicar la landing del taller", "prueba ítem 3");
  orientationMap.openMapFront(root, "Corregir el cobro con tarjeta (urgente: vence el viernes)", "prueba ítem 3");
}

// Texto crudo de los mensajes capturados (sin serializar): la
// comparación byte a byte del caso ASK exige el contenido tal cual
// viajó ante el modelo.
function rawText(captures) {
  const chunks = [];
  const walk = (value) => {
    if (typeof value === "string") chunks.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const c of captures) walk(c.messages);
  return chunks.join("\n");
}

async function runTurn({ root, message, threadId, reply }) {
  const captures = [];
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      captures.push({ messages: args?.messages || [], tools: args?.tools || [] });
      return { text: reply, toolCalls: [], usage: USAGE };
    },
  };
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message,
    projectRoot: root,
    threadId,
    helpers,
  });
  assert.ok(calls >= 1, "hubo al menos una llamada al proveedor");
  return { res, payload: rawText(captures) };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 }).trim();
}

function gitProject() {
  const root = emptyProject({ "package.json": PKG, "app.txt": "versión 1\n" });
  git(root, ["init"]);
  git(root, ["config", "user.email", "item3@example.invalid"]);
  git(root, ["config", "user.name", "Item3"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "commit inicial item3"]);
  // Cambio real sin commitear, como en la prueba 6.2.
  fs.writeFileSync(path.join(root, "app.txt"), "versión 2 sin commitear\n");
  return root;
}

// ------------------------------------------------------------ (1)
test("(1) EXECUTE «Publica este proyecto» con Mapa sembrado: el bloque Mapa del payload NO contiene la cláusula de autoridad", async () => {
  const root = emptyProject({ "package.json": PKG });
  seedMap(root);
  const { payload } = await runTurn({
    root,
    message: "Publica este proyecto",
    threadId: "hilo-item3-execute",
    reply: "Reviso el estado real del proyecto y avanzo con la publicación desde la evidencia de este turno. Siguiente paso: ejecutar la publicación con la herramienta de publicación.",
  });
  assert.match(payload, /MAPA DE ORIENTACIÓN/, "el bloque del Mapa SÍ viaja en el turno EXECUTE (orienta, no desaparece)");
  assert.match(payload, /Publicar la landing del taller/, "la sustancia del Mapa viaja en el turno EXECUTE");
  assert.doesNotMatch(payload, new RegExp(CLAUSULA_AUTORIDAD), "el bloque Mapa de un turno EXECUTE NO contiene la cláusula de autoridad «manda sobre relatos viejos»");
});

// ------------------------------------------------------------ (2)
test("(2) EXECUTE con intención de mutación y repo git real: el contexto incluye el hecho git determinista «cambios sin commitear: sí»", async () => {
  const root = gitProject();
  seedMap(root);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const lastHash = git(root, ["log", "-1", "--pretty=format:%h"]);
  const { payload } = await runTurn({
    root,
    message: "Publica este proyecto",
    threadId: "hilo-item3-git",
    reply: "Reviso el estado real del proyecto y avanzo con la publicación desde la evidencia de este turno. Siguiente paso: ejecutar la publicación con la herramienta de publicación.",
  });
  assert.match(payload, /HECHO GIT/, "el contexto del turno incluye el bloque del hecho git determinista");
  assert.match(payload, /cambios sin commitear: sí/i, "el hecho git registra «cambios sin commitear: sí» (hay un cambio real sin commitear)");
  assert.ok(payload.includes(`Rama: ${branch}`), `el hecho git registra la rama real (${branch})`);
  assert.ok(payload.includes(lastHash), `el hecho git registra el último commit (${lastHash})`);
});

// ------------------------------------------------------------ (3)
test("(3) ASK «¿qué queda pendiente?» con el mismo Mapa: el bloque Mapa es idéntico al actual, con la cláusula de autoridad completa (blindaje)", async () => {
  const root = emptyProject({ "package.json": PKG, "src/index.js": "console.log(1);\n" });
  seedMap(root);
  // La forma ASK de buildMapBlock (sin argumentos de ejecución) es,
  // por definición, la cabecera vigente blindada.
  const bloqueAskEsperado = orientationMap.buildMapBlock(root);
  assert.ok(bloqueAskEsperado.includes(CLAUSULA_AUTORIDAD), "la forma ASK de buildMapBlock conserva la cláusula de autoridad completa");
  const { payload } = await runTurn({
    root,
    message: "¿qué queda pendiente?",
    threadId: "hilo-item3-ask",
    reply: "Quedan dos pendientes: publicar la landing del taller y corregir el cobro con tarjeta, que es el urgente porque vence el viernes.",
  });
  assert.ok(payload.includes(bloqueAskEsperado), "el bloque del Mapa que viajó en el turno ASK es byte a byte el bloque vigente (buildMapBlock en su forma ASK)");
});

// ------------------------------------------------------------ (4)
test("(4) guarda: EXECUTE con intención de mutación en un directorio que NO es repo git: el turno completa sin el hecho git y sin error", async () => {
  const root = emptyProject({ "package.json": PKG });
  seedMap(root);
  const { res, payload } = await runTurn({
    root,
    message: "Publica este proyecto",
    threadId: "hilo-item3-sin-git",
    reply: "Reviso el estado real del proyecto y avanzo con la publicación desde la evidencia de este turno. Siguiente paso: ejecutar la publicación con la herramienta de publicación.",
  });
  assert.equal(typeof res.text, "string", "el turno completó con texto final");
  assert.ok(res.text.length > 0, "el texto final no está vacío");
  assert.doesNotMatch(payload, /HECHO GIT/, "sin repo git, el hecho git se omite del contexto");
  assert.doesNotMatch(payload, /cambios sin commitear/i, "sin repo git, no se afirma nada sobre cambios sin commitear");
});
