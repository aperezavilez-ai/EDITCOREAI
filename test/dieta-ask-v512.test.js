"use strict";

// Batería v5.1.2 — dieta del payload del carril de preguntas (segunda
// mitad de la corrección del carril ASK; medición MEDICION-PAYLOAD-ASK:
// el turno de orientación pesaba 33.363 caracteres, la mitad en
// definiciones de herramientas que el turno no puede usar, y el
// historial archivaba el mensaje YA ENSAMBLADO, recomprando el
// andamiaje de cada turno previo):
//  (i)   el payload de un turno ASK no contiene definiciones de
//        herramientas de escritura y sí las de lectura (set de solo
//        lectura, la maquinaria del filtro de CHAT).
//        [V514] La (i) se re-delimitó con la v5.1.4 — justificación
//        completa junto a la prueba: su fixture ejerce el CARRIL DE
//        ORIENTACIÓN, y la P2 de la v5.1.4 dejó ese carril sin
//        herramientas de lectura/exploración a propósito (responde
//        desde el bloque compartido). La premisa «en ASK viaja el
//        set de lectura» sigue viva FUERA del carril y la afirma la
//        nueva (i-bis); dentro del carril manda el invariante nuevo.
//  (ii)  dos turnos de orientación seguidos: la entrada archivada del
//        usuario es su texto ORIGINAL (sin el catálogo ni el bloque
//        compartido dentro) y el payload del turno 2 no arrastra una
//        segunda copia del catálogo desde el historial — el
//        crecimiento entre turnos queda acotado al par archivado.
//  (iii) en ASK el bloque de skills trae los ids SIN extractos.
//        [V517] (iii-bis): en un turno de ejecución el catálogo
//        TAMBIÉN viaja solo con ids (C4). La aserción original de
//        este caso («en ejecución los extractos siguen») fijaba una
//        cautela de diseño de la v5.1.2, no un comportamiento
//        aprobado en vivo; la medición M3 la preció en 180.852
//        caracteres por turno escenario y Lu aprobó la
//        re-delimitación el 2026-11-13 (justificación completa
//        junto a la prueba).
//  (iv)  un hecho centinela del expediente aparece exactamente UNA
//        vez en el payload de orientación (la copia estándar de
//        buildMessageList se suprime cuando el bloque compartido ya
//        trae el expediente deduplicado).
//  (v)   la batería de la v5.1.1 (orientacion-ask-v511) sigue pasando
//        íntegra — se verifica corriéndola junto a esta suite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v512-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
// La capa USUARIO del Mapa vive en ~/.editcore: HOME temporal.
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const threadCore = require("../editcore-chat-kernel/thread-core");
const { QUESTION_READ_TOOLS, WRITE_TOOLS } = require("../editcore-chat-kernel/classify");

// callChat falso que captura mensajes Y herramientas tal cual salen.
function capturingHelpers(script, captures) {
  const helpers = {
    callChat: async (args) => {
      if (captures) {
        captures.push({
          messages: JSON.parse(JSON.stringify(args?.messages || [])),
          tools: JSON.parse(JSON.stringify(args?.tools || [])),
        });
      }
      return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
    },
  };
  return { helpers };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v512-proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const BASE_ARGS = {
  apiKey: "sk-test",
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};

const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };

function seedFronts(root) {
  orientationMap.openMapFront(root, "Publicar la landing del taller", "prueba v5.1.2");
  orientationMap.openMapFront(root, "Corregir el cobro con tarjeta (urgente: vence el viernes)", "prueba v5.1.2");
}

const count = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------- (i)
test("(i) un turno ASK viaja con el set de SOLO LECTURA: sin herramientas de escritura, con las de lectura", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  seedFronts(root);
  const captures = [];
  const { helpers } = capturingHelpers([
    { text: "Quedan dos pendientes: publicar la landing y corregir el cobro.", toolCalls: [], usage: USAGE },
    { text: "Quedan dos pendientes.", toolCalls: [], usage: USAGE },
  ], captures);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v512-i", helpers,
  });
  assert.ok((res.steps || []).some((s) => s.name === "orientation_first"), "el turno fue por el carril de orientación");
  assert.ok(captures.length >= 1, "el turno llegó al modelo");
  const names = captures[0].tools.map((t) => t.function?.name || t.name).filter(Boolean);
  for (const name of names) {
    assert.ok(QUESTION_READ_TOOLS.has(name), `la definición ofrecida es de solo lectura: ${name}`);
    assert.ok(!WRITE_TOOLS.includes(name), `ninguna definición de escritura viaja en ASK: ${name}`);
  }
  // [EDITCORE-V514-P2] JUSTIFICACIÓN DEL RE-DELIMITADO (precedente:
  // la A2 de cache-dieta-v500 en la propia v5.1.2): esta prueba
  // afirmaba que en ESTE turno — que va por el carril de
  // orientación — viajaban read_file/list_files y
  // capture_preview_screenshot. Esa premisa era la dieta de la
  // v5.1.2 para los turnos de pregunta EN GENERAL; la v5.1.4 la
  // supera PARA EL CARRIL: la medición del primer turno probó que
  // con herramientas de lectura disponibles el modelo verifica en
  // disco antes de responder aunque el bloque ya traiga la
  // respuesta, así que el carril quedó SIN herramientas de
  // lectura/exploración (solo puede viajar search_brain, consulta
  // de memoria). El invariante que SÍ manda desde la v5.1.2 sigue
  // afirmado arriba (ninguna escritura viaja en ASK; todo lo
  // ofrecido es del set de preguntas) y el set completo de lectura
  // fuera del carril lo afirma la (i-bis) nueva, con la captura del
  // preview donde el protocolo de visión (v4.9.3) la ejerce.
  for (const name of ["list_files", "read_file", "search_files", "git_status", "git_log", "git_diff", "read_pdf", "capture_preview_screenshot"]) {
    assert.ok(!names.includes(name), `en el CARRIL de orientación ya NO viaja ${name} (v5.1.4-P2: responde desde el bloque)`);
  }
  assert.ok(names.every((n) => n === "search_brain"), `en el carril solo puede viajar search_brain (memoria); viajaron: ${names.join(", ") || "ninguna"}`);
  assert.ok(!names.includes("write_file") && !names.includes("replace_in_file") && !names.includes("run_command"), "write_file / replace_in_file / run_command NO viajan en un turno de pregunta");
});

// ------------------------------------------------------------ (i-bis)
test("(i-bis) fuera del carril, el turno ASK conserva el set de solo lectura COMPLETO (lectura + captura del preview)", async () => {
  // La (i) ejerce el carril de orientación; la premisa original de
  // la v5.1.2 — en ASK viaja el set de preguntas entero — sigue
  // viva en los demás turnos de pregunta. Aquí: pregunta de código
  // por el carril del explorador (ask_explorer).
  const root = emptyProject({
    "package.json": JSON.stringify({ name: "demo" }),
    "src/total.js": "export function calcularTotal(items) { return items.reduce((a, b) => a + b.precio, 0); }\n",
  });
  const captures = [];
  const { helpers } = capturingHelpers([
    { text: "El total se calcula en src/total.js, en la función calcularTotal.", toolCalls: [], usage: USAGE },
    { text: "El total se calcula en src/total.js.", toolCalls: [], usage: USAGE },
  ], captures);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿dónde se calcula el total de la compra?",
    projectRoot: root, threadId: "hilo-v512-i-bis", helpers,
  });
  assert.ok((res.steps || []).some((s) => s.name === "ask_explorer"), "el turno fue por el carril del explorador (fuera del de orientación)");
  assert.ok(captures.length >= 1, "el turno llegó al modelo");
  const names = captures[0].tools.map((t) => t.function?.name || t.name).filter(Boolean);
  assert.ok(names.length > 0, "el turno sí ofrece herramientas (las de lectura)");
  for (const name of names) {
    assert.ok(QUESTION_READ_TOOLS.has(name), `la definición ofrecida es de solo lectura: ${name}`);
    assert.ok(!WRITE_TOOLS.includes(name), `ninguna definición de escritura viaja en ASK: ${name}`);
  }
  assert.ok(names.includes("read_file") && names.includes("list_files"), "las herramientas de lectura están (read_file, list_files)");
  // La captura del preview es observación y el protocolo de revisión
  // visual (v4.9.3) la exige ofrecida en los turnos de pregunta.
  assert.ok(names.includes("capture_preview_screenshot"), "capture_preview_screenshot SÍ viaja (observación; protocolo de visión v4.9.3)");
  assert.ok(!names.includes("write_file") && !names.includes("replace_in_file") && !names.includes("run_command"), "write_file / replace_in_file / run_command NO viajan en un turno de pregunta");
});

// --------------------------------------------------------------- (ii)
test("(ii) el verbatim archiva las palabras originales y el turno 2 no recompra el andamiaje del turno 1", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  seedFronts(root);
  const reply1 = "Quedan dos pendientes: publicar la landing del taller y corregir el cobro con tarjeta, que es el urgente porque vence el viernes. El resto del proyecto está cerrado y verificado.";
  const captures1 = [];
  const s1 = capturingHelpers([
    { text: reply1, toolCalls: [], usage: USAGE },
    { text: reply1, toolCalls: [], usage: USAGE },
  ], captures1);
  const first = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v512-ii", helpers: s1.helpers,
  });
  assert.ok((first.steps || []).some((s) => s.name === "orientation_first"), "el turno 1 fue por orientación");

  // El registro guarda las palabras originales del usuario, no el
  // mensaje ensamblado (que llevaba catálogo, bloque compartido y
  // contexto del turno dentro).
  const archived = threadMemory.verbatimMessages(root, "hilo-v512-ii");
  const archivedUser = archived.filter((m) => m.role === "user");
  assert.equal(archivedUser.length, 1, "hay una entrada de usuario archivada");
  assert.strictEqual(archivedUser[0].content, "¿qué queda pendiente?", "la entrada archivada es el texto original, palabra por palabra");
  assert.ok(!String(archivedUser[0].content).includes("SKILLS VÁLIDAS"), "la entrada archivada NO trae el catálogo de skills dentro");
  assert.ok(!String(archivedUser[0].content).includes("MAPA DE ORIENTACIÓN"), "la entrada archivada NO trae el bloque de memoria compartida dentro");

  const reply2 = "De esos pendientes, el más urgente es corregir el cobro con tarjeta, porque vence el viernes.";
  const captures2 = [];
  const s2 = capturingHelpers([
    { text: reply2, toolCalls: [], usage: USAGE },
    { text: reply2, toolCalls: [], usage: USAGE },
  ], captures2);
  const second = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿de esos pendientes, cuál es el más urgente?",
    projectRoot: root, threadId: "hilo-v512-ii", helpers: s2.helpers,
  });
  assert.ok((second.steps || []).some((s) => s.name === "orientation_first"), "el turno 2 también fue por orientación");
  assert.ok(captures2.length >= 1, "el turno 2 llegó al modelo");

  const payload1 = JSON.stringify(captures1[0].messages);
  const payload2 = JSON.stringify(captures2[0].messages);
  // El historial del turno 2 trae la pregunta original como mensaje
  // propio (las palabras del usuario), no el mensaje ensamblado.
  assert.ok(captures2[0].messages.some((m) => m.role === "user" && m.content === "¿qué queda pendiente?"), "el historial trae la pregunta original como mensaje, sin ensamblar");
  // Ni el catálogo ni el bloque compartido se duplican desde el
  // historial: cada uno viaja UNA vez (la del turno en curso).
  assert.equal(count(payload2, "SKILLS VÁLIDAS EN DISCO"), 1, "el catálogo de skills viaja una sola vez en el turno 2 (no viene otra copia en el historial)");
  assert.equal(count(payload2, "MAPA DE ORIENTACIÓN"), 1, "el bloque de memoria compartida viaja una sola vez en el turno 2");
  // El crecimiento entre turnos queda acotado al par archivado en
  // textos originales (pregunta breve + respuesta), no al mensaje
  // ensamblado del turno 1 (~16 mil caracteres en la medición).
  const growth = payload2.length - payload1.length;
  assert.ok(growth > 0, "el turno 2 trae el historial del turno 1");
  assert.ok(growth < 6000, `el crecimiento entre turnos es el par archivado, no el andamiaje (Δ=${growth} caracteres)`);
});

// ------------------------------------------------- (iii) + (iii-bis)
// [V517 — RE-DELIMITACIÓN APROBADA POR LU, 2026-11-13] Este caso
// nació en la v5.1.2 con dos aserciones: en ASK el catálogo viaja
// solo con ids (R3) y en ejecución «los extractos siguen». La
// segunda era una decisión de diseño CONSERVADORA de la v5.1.2
// (limitar el radio de R3 por cautela), NO un comportamiento
// aprobado en vivo por Luis. La medición M3
// (audit-fase-a-cache/MEDICION-M3.md) la preció: los extractos de
// skills en EXECUTE cuestan 180.852 caracteres por turno escenario
// (~5,7 %), pagados en CADA llamada, y la vía de escape (read_skill
// bajo demanda) ya vive probada en el carril de preguntas. Lu
// aprobó C4 con esta re-delimitación, al precedente de la v5.1.4
// ((i) → (i-bis)): la aserción ASK de (iii) queda INTACTA y la
// aserción EXECUTE se convierte en (iii-bis), que fija la política
// nueva dentro de este mismo caso: en EXECUTE el catálogo viaja
// con ids y SIN «Extracto:», read_skill sigue disponible en el set
// y el set completo de herramientas se conserva (write_file
// visible, como ya afirmaba el caso).
test("(iii) en ASK las skills viajan solo con ids (sin extractos); (iii-bis) en EXECUTE también viajan solo con ids (C4, v5.1.7)", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  seedFronts(root);
  const capturesAsk = [];
  const sAsk = capturingHelpers([
    { text: "Quedan dos pendientes.", toolCalls: [], usage: USAGE },
    { text: "Quedan dos pendientes.", toolCalls: [], usage: USAGE },
  ], capturesAsk);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v512-iii-ask", helpers: sAsk.helpers,
  });
  assert.ok(capturesAsk.length >= 1, "el turno ASK llegó al modelo");
  const askPayload = JSON.stringify(capturesAsk[0].messages);
  assert.ok(askPayload.includes("SKILLS VÁLIDAS EN DISCO"), "en ASK el catálogo viaja (con los ids de todas las skills)");
  assert.ok(!askPayload.includes("Extracto:"), "en ASK el catálogo NO trae extractos de skills");

  const capturesExec = [];
  const sExec = capturingHelpers([
    { text: "Creé el archivo saludo.txt con el saludo.", toolCalls: [], usage: USAGE },
    { text: "Creé el archivo saludo.txt con el saludo.", toolCalls: [], usage: USAGE },
    { text: "Creé el archivo saludo.txt con el saludo.", toolCalls: [], usage: USAGE },
    { text: "Creé el archivo saludo.txt con el saludo.", toolCalls: [], usage: USAGE },
  ], capturesExec);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "crea el archivo saludo.txt con el texto hola",
    projectRoot: root, threadId: "hilo-v512-iii-exec", helpers: sExec.helpers,
  });
  assert.ok(capturesExec.length >= 1, "el turno de ejecución llegó al modelo");
  const execPayload = JSON.stringify(capturesExec[0].messages);
  // (iii-bis) Política nueva (C4, v5.1.7): en EXECUTE el catálogo
  // viaja como en ASK — con los ids y SIN extractos — y el cuerpo
  // completo de una skill se pide con read_skill cuando hace falta.
  assert.ok(execPayload.includes("SKILLS VÁLIDAS EN DISCO"), "en ejecución el catálogo viaja (con los ids de todas las skills)");
  assert.ok(!execPayload.includes("Extracto:"), "en ejecución el catálogo NO trae extractos de skills (C4)");
  const execTools = capturesExec[0].tools.map((t) => t.function?.name || t.name);
  assert.ok(execTools.includes("read_skill"), "read_skill sigue disponible en ejecución como vía de escape bajo demanda");
  assert.ok(execTools.includes("write_file"), "el turno de ejecución conserva el set completo (write_file visible)");
});

// --------------------------------------------------------------- (iv)
test("(iv) el expediente entra UNA sola vez al payload de orientación (sin la copia estándar duplicada)", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  seedFronts(root);
  threadMemory.noteDecision(root, "El proveedor de pallets del taller es CENTINELA-V512-9F3K y se paga a 30 días");
  const captures = [];
  const { helpers } = capturingHelpers([
    { text: "Quedan dos pendientes: publicar la landing y corregir el cobro.", toolCalls: [], usage: USAGE },
    { text: "Quedan dos pendientes.", toolCalls: [], usage: USAGE },
  ], captures);
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué queda pendiente?",
    projectRoot: root, threadId: "hilo-v512-iv", helpers,
  });
  assert.ok((res.steps || []).some((s) => s.name === "orientation_first"), "el turno fue por el carril de orientación");
  assert.ok(captures.length >= 1, "el turno llegó al modelo");
  const payload = JSON.stringify(captures[0].messages);
  assert.ok(payload.includes("CENTINELA-V512-9F3K"), "el hecho del expediente SÍ llega al modelo (en el bloque compartido)");
  assert.equal(count(payload, "CENTINELA-V512-9F3K"), 1, "el hecho del expediente aparece exactamente UNA vez en el payload (sin la copia estándar de buildMessageList)");
  assert.equal(count(payload, "EXPEDIENTE DEL PROYECTO"), 1, "el expediente completo entra una sola vez al payload de orientación");
});

// Guarda de la costura R2 a nivel de unidad: rememberExchange con el
// texto original archiva eso, y sin texto original no escribe verbatim
// (los llamadores directos históricos quedan como estaban).
test("(ii-bis) rememberExchange archiva meta.originalUserText y no el mensaje ensamblado", () => {
  const root = emptyProject();
  threadCore.rememberExchange(root, "hilo-v512-bis", "palabras originales del usuario", "Respuesta del agente.", {
    originalUserText: "palabras originales del usuario",
    sentUserMessage: { role: "user", content: "MENSAJE ENSAMBLADO CON ANDAMIAJE QUE NO DEBE ARCHIVARSE" },
  });
  const archived = threadMemory.verbatimMessages(root, "hilo-v512-bis");
  assert.equal(archived.length, 2, "el intercambio quedó registrado (usuario + respuesta)");
  assert.strictEqual(archived[0].content, "palabras originales del usuario");
  assert.ok(!JSON.stringify(archived).includes("ANDAMIAJE"), "el mensaje ensamblado NO entró al registro");
});
