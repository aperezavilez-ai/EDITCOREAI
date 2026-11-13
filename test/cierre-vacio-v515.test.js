"use strict";

// Batería v5.1.5 — el cierre en vacío de una TAREA se REANUDA, no se
// constata como primera respuesta (medición MEDICION-CIERRE-VACIO;
// incidente en vivo ALFA LUBES v5.1.4: la tarea de init_db() murió en
// su primera respuesta — sin toolCalls, texto vacío o solo narración —
// y el turno volvió «completado» con 34.527 tokens y 0 aplicados; la
// única red, B2, pide SÍNTESIS de hechos que no existen cuando no hay
// ni un paso, y provider_calls solo contaba respuestas con usage, así
// que ni siquiera era auditable si la red había corrido):
//  (i)   primera respuesta a una TAREA = pura narración («Listo la
//        carpeta.») y SIN usage ⇒ R1 reanuda la EJECUCIÓN dentro del
//        mismo turno (la orden de ejecutar viaja en la llamada 2), el
//        modelo trabaja (write_file), la escritura queda aplicada,
//        applied_step_tokens > 0, NO aparece la constancia, el turno
//        vuelve completo y provider_calls = 3 (R4: la respuesta sin
//        usage también contó como llamada).
//  (ii)  primera respuesta en texto VACÍO ⇒ mismo resultado: reanuda
//        y aplica (la sub-forma del incidente: markup no parseable
//        que el strip borra entero deja exactamente este vacío).
//  (iii) guion VENENO (siempre narración, nunca usage) ⇒ exactamente
//        UNA reanudación + el empujón de síntesis de B2 (3 llamadas,
//        acotadas: sin bucle de cobro), después la constancia — que
//        DECLARA la reanudación intentada (R2) — y el retorno vuelve
//        incomplete: true con la marca emptyClose (R3), con
//        provider_calls = 3 pese a que ninguna respuesta trajo usage.
//  (iv)  REPARTO: narración DESPUÉS de un paso (list_files) ⇒ manda
//        B2 como siempre (síntesis), la reanudación NO se dispara:
//        ninguna llamada lleva la orden de ejecutar y la respuesta
//        final es la síntesis.
// La (iv) de la especificación — las baterías vecinas íntegras
// (cerebro-agentico-v510 con sus dos pruebas B2, escritura-mapa-v513,
// orientacion-ask-v511, dieta-ask-v512, cache-dieta-v500 y
// primer-turno-v514) — se verifica corriéndolas junto a esta suite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v515-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
// La capa USUARIO del Mapa vive en ~/.editcore: HOME temporal.
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// Respondedor dinámico: registra las fotos de mensajes de cada
// llamada y delega la respuesta al guion (nº de llamada, args).
function dynamicHelpers(handler, snapshots) {
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      if (snapshots) snapshots.push(JSON.stringify(args?.messages || []));
      return handler(calls, args);
    },
  };
  return { helpers, count: () => calls };
}

function lastUserText(args) {
  const lastUser = [...(args.messages || [])].reverse().find((m) => m.role === "user");
  return typeof lastUser?.content === "string" ? lastUser.content : "";
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v515-proj-"));
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
const TASK = "crea el archivo notas.txt con un saludo";
const TERMINUS = "Doy por terminado este encargo porque el archivo notas.txt quedó creado en disco con el saludo pedido.";
const RESUME_ORDER = "Ejecuta AHORA la tarea pedida";
const SYNTH_ORDER = "Tu cierre no es una respuesta";

// ---------------------------------------------------------------- (i)
test("R1: narración pura como primera respuesta a una tarea ⇒ reanuda la ejecución y aplica", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const snapshots = [];
  // La escritura se pide UNA sola vez (bandera): tras ejecutarse, el
  // último mensaje «user» sigue siendo la orden de reanudación — los
  // resultados de herramienta viajan con otro rol — y sin la bandera
  // el guion re-pediría la escritura en cada llamada (bucle que el
  // guardián de avance B4 cortó en la depuración de esta batería).
  let wrote = false;
  const { helpers, count } = dynamicHelpers((calls, args) => {
    // La primera respuesta no trae usage a propósito (R4): la
    // llamada debe contar igual en el recibo.
    if (calls === 1) return { text: "Listo la carpeta.", toolCalls: [] };
    if (!wrote && lastUserText(args).includes(RESUME_ORDER)) {
      wrote = true;
      return { text: "", toolCalls: [toolCall("write_file", { path: "notas.txt", content: "Hola, taller.\n" })], usage: USAGE };
    }
    return { text: TERMINUS, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: TASK, projectRoot: root, threadId: "hilo-v515-i", helpers,
  });
  assert.equal(fs.readFileSync(path.join(root, "notas.txt"), "utf8"), "Hola, taller.\n", "la escritura quedó aplicada en disco");
  assert.ok(snapshots.some((snap) => snap.includes(RESUME_ORDER)), "la orden de EJECUTAR (no de sintetizar) viajó en la llamada siguiente al cierre en vacío");
  assert.equal(count(), 3, "tres llamadas: cierre en vacío, escritura tras la reanudación, cierre sustantivo");
  assert.equal(out.usage.provider_calls, 3, "R4: la primera respuesta, sin usage, también contó como llamada al proveedor");
  assert.ok(out.usage.applied_step_tokens > 0, "el recibo distingue tokens APLICADOS > 0 (la iteración de la escritura se asentó como aplicada)");
  assert.doesNotMatch(out.text, /Cierre del kernel \(el modelo no dejó respuesta sustantiva\)/, "NO aparece la constancia de cierre en vacío");
  assert.equal(out.incomplete, false, "el turno vuelve completo: la tarea se ejecutó");
  assert.equal(out.report.completed, true);
});

// ---------------------------------------------------------------- (ii)
test("R1: texto vacío como primera respuesta a una tarea ⇒ reanuda la ejecución y aplica", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const snapshots = [];
  let wrote = false;
  const { helpers, count } = dynamicHelpers((calls, args) => {
    if (calls === 1) return { text: "", toolCalls: [], usage: USAGE };
    if (!wrote && lastUserText(args).includes(RESUME_ORDER)) {
      wrote = true;
      return { text: "", toolCalls: [toolCall("write_file", { path: "notas.txt", content: "Hola, taller.\n" })], usage: USAGE };
    }
    return { text: TERMINUS, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: TASK, projectRoot: root, threadId: "hilo-v515-ii", helpers,
  });
  assert.equal(fs.readFileSync(path.join(root, "notas.txt"), "utf8"), "Hola, taller.\n", "la escritura quedó aplicada en disco");
  assert.ok(snapshots.some((snap) => snap.includes(RESUME_ORDER)), "la orden de ejecutar viajó tras el cierre vacío");
  assert.equal(count(), 3, "tres llamadas: vacío, escritura tras la reanudación, cierre sustantivo");
  assert.ok(out.usage.applied_step_tokens > 0, "aplicados > 0 en el recibo");
  assert.doesNotMatch(out.text, /Cierre del kernel \(el modelo no dejó respuesta sustantiva\)/, "sin constancia");
  assert.equal(out.incomplete, false);
});

// ---------------------------------------------------------------- (iii)
test("R1+R2+R3: guion veneno ⇒ una reanudación, constancia que la declara y retorno incompleto, sin bucle", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const snapshots = [];
  // Veneno: siempre la misma narración y NUNCA usage — el recibo
  // histórico habría dicho «0 llamadas».
  const { helpers, count } = dynamicHelpers(() => ({ text: "Listo la carpeta.", toolCalls: [] }), snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: TASK, projectRoot: root, threadId: "hilo-v515-iii", helpers,
  });
  assert.equal(count(), 3, "llamadas acotadas: la original + UNA reanudación (R1) + el empujón de síntesis (B2); no hay bucle de cobro");
  assert.ok(snapshots[1].includes(RESUME_ORDER), "la segunda llamada llevó la orden de ejecutar (R1 corrió primero)");
  assert.ok(snapshots[2].includes(SYNTH_ORDER), "la tercera llamada llevó la orden de síntesis (B2 conserva su sitio tras la reanudación)");
  assert.match(out.text, /Cierre del kernel \(el modelo no dejó respuesta sustantiva\)/, "agotadas las redes, el cierre es la constancia honesta");
  assert.match(out.text, /reanudó la ejecución una vez/, "R2: la constancia DECLARA la reanudación intentada en sus hechos");
  assert.equal(out.incomplete, true, "R3: el turno vuelve INCOMPLETO, no completado");
  assert.equal(out.emptyClose, true, "R3: marca emptyClose en el resultado");
  assert.equal(out.report.completed, false, "R3: report.completed deja de mentir");
  assert.equal(out.report.emptyClose, true, "R3: marca emptyClose también en el reporte");
  assert.equal(out.usage.provider_calls, 3, "R4: tres respuestas reales del proveedor contadas aunque ninguna trajo usage");
  assert.equal(out.usage.applied_step_tokens, 0, "nada se aplicó y el libro lo dice");
  assert.equal(fs.existsSync(path.join(root, "notas.txt")), false, "ninguna escritura fantasma");
});

// ---------------------------------------------------------------- (iv)
test("Reparto: narración DESPUÉS de un paso ⇒ manda B2 (síntesis); la reanudación no se dispara", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  const SYNTH = "El proyecto es una base mínima: tiene package.json y src/index.js. Propongo agregar una página de contacto y una sección de servicios para que supere a una plantilla pelada.";
  const snapshots = [];
  const { helpers } = dynamicHelpers((calls, args) => {
    if (calls === 1) return { text: "", toolCalls: [toolCall("list_files", { path: "." })], usage: USAGE };
    if (calls === 2) return { text: "Listo la carpeta.", toolCalls: [], usage: USAGE };
    if (lastUserText(args).includes(SYNTH_ORDER)) return { text: SYNTH, toolCalls: [], usage: USAGE };
    return { text: SYNTH, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué podemos mejorar o agregar para que este proyecto sea mejor que otros?",
    projectRoot: root, threadId: "hilo-v515-iv", helpers,
  });
  assert.ok(snapshots.some((snap) => snap.includes(SYNTH_ORDER)), "con pasos/hechos, la red que habla es B2: orden de síntesis");
  assert.ok(!snapshots.some((snap) => snap.includes(RESUME_ORDER)), "la orden de reanudar la ejecución NUNCA viajó: con pasos no hay reanudación");
  assert.match(out.text, /Propongo agregar una página de contacto/, "la respuesta final es la síntesis, como en la batería B2 original");
  assert.equal(out.incomplete, false);
});
