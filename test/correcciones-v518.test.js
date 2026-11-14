"use strict";

// Batería v5.1.8 — dos correcciones de raíz probadas EN VIVO sobre la
// v5.1.7 en ALFA LUBES:
//  (A) HIGIENE DE SOLICITUD: la guarda P8 (v5.1.6) barría los VALORES
//      de credenciales que el agente imprime, pero el agente PIDIÓ el
//      valor por el chat («Si me dices el valor de AI_API_KEY (o me
//      autorizas a escribir .env con ella), lo configuro»). Ahora un
//      barrido determinista en los mismos sitios de finalización
//      sustituye la frase solicitante por la redirección segura (el
//      usuario coloca el valor en el .env o en la bóveda; el agente
//      verifica su presencia por nombre) y el hecho queda en los
//      hechos del kernel. Negativos obligatorios: pedir el NOMBRE de
//      una variable, pedir «procede» y hablar de claves en general NO
//      son solicitud de valor y salen byte a byte.
//  (B) EL TURNO EXECUTE CONSUME EL MAPA DEL PROPIO HILO: una
//      continuación («ya esta en el env la api») gastó 24 pasos y
//      452.638 tokens re-explorando app.py, ya mapeado dos turnos
//      antes (clave ~línea 45, _call_ai_service ~línea 1196), hasta
//      que el guardián B4 lo detuvo. B1: índice de leídos POR HILO y
//      por ARCHIVO (el comprobante A3 es por archivo+rango y otro
//      rango no casaba) — la relectura en EXECUTE de un archivo ya
//      leído en el hilo y sin cambios devuelve un stub breve; toda
//      escritura invalida la entrada; force:true siempre lee real.
//      B2: la apertura EXECUTE lleva el bloque «Ya conocido en este
//      hilo» (artefactos S2 + índice de leídos, ≤600 caracteres).
//      En ASK no hay stub de hilo ni bloque: el carril queda intacto.
//      El stub no cuenta como paso aplicado (leer nunca aplica) y el
//      guardián B4 no se toca.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v518-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const {
  ChatOrchestrator,
  redirectCredentialSolicitations,
  credentialSolicitationIn,
  buildThreadKnownBlock,
  buildKernelFactSummary,
} = require("../editcore-chat-kernel/orchestrator");
const tokenHarness = require("../runtime/agent-token-harness");
const threadMemory = require("../editcore-chat-kernel/thread-memory");

const BASE_ARGS = {
  apiKey: ["sk", "fake", "v518"].join("-"),
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };

let callSeq = 0;
function toolCall(name, args) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedHelpers(script, captures) {
  let calls = 0;
  return {
    callChat: async (args) => {
      calls += 1;
      if (captures) captures.push({ messages: args?.messages || [], tools: args?.tools || [] });
      const step = script[Math.min(calls - 1, script.length - 1)];
      return typeof step === "function" ? step(calls, args) : step;
    },
  };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(tmpBase, "proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// app.py de 60 líneas con marcas por rango: la línea 5 vive en el
// rango 1-10 y la 50 en el 40-60 — dos rangos DISTINTOS del mismo
// archivo, el caso que el comprobante A3 (por rango) no cubría.
function appPy() {
  const lines = [];
  for (let i = 1; i <= 60; i += 1) {
    if (i === 5) lines.push("AI_API_KEY = os.environ.get('AI_API_KEY')  # MARCA_LINEA_5");
    else if (i === 50) lines.push("def _call_ai_service(prompt):  # MARCA_LINEA_50");
    else lines.push(`# relleno ${i}`);
  }
  return `${lines.join("\n")}\n`;
}
const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

// ------------------------------------------------------------ (A1)
test("(A1) solicitud en español (la frase real en vivo) se detecta y se redirige; el resto del texto queda intacto", () => {
  const live = "¿Tienes la clave de IA disponible? Si me dices el valor de AI_API_KEY (o me autorizas a escribir .env con ella), lo configuro y pruebo de inmediato con la pregunta del Versa 2019.";
  const r = redirectCredentialSolicitations(live);
  assert.equal(r.count, 1, "exactamente una frase solicitante");
  assert.ok(!r.text.includes("me dices el valor"), "la frase que pedía el valor ya no está");
  assert.ok(!r.text.includes("lo configuro y pruebo de inmediato"), "la frase solicitante se sustituye ENTERA, no se recorta a la mitad");
  assert.ok(r.text.includes("¿Tienes la clave de IA disponible?"), "la frase previa, que no pide ningún valor, sobrevive");
  assert.ok(r.text.includes(".env"), "la redirección nombra el .env (y su punto no rompió el corte en frases)");
  assert.ok(r.text.includes("verifico su presencia por nombre"), "la redirección segura declara la vía: presencia por nombre, sin mostrar el valor");
});

test("(A1b) solicitudes en inglés también se redirigen", () => {
  const en1 = redirectCredentialSolicitations("Can you tell me your API key so I can configure it for you?");
  assert.equal(en1.count, 1);
  assert.ok(!en1.text.includes("tell me your API key"));
  const en2 = redirectCredentialSolicitations("Please share your password with me and I will set it up right away.");
  assert.equal(en2.count, 1);
  assert.ok(en2.text.includes(".env"));
  const es = redirectCredentialSolicitations("Dime tu contraseña de administrador y la dejo configurada.");
  assert.equal(es.count, 1, "imperativo español directo también casa");
  const cual = redirectCredentialSolicitations("¿Cuál es tu clave de API? Así la dejo puesta en el proyecto.");
  assert.equal(cual.count, 1, "la pregunta por el valor («¿cuál es tu clave?») también es solicitud");
});

// ------------------------------------------------------------ (A2)
test("(A2) negativos obligatorios: nombre de variable, «procede», presencia y texto general NO son solicitud", () => {
  const negatives = [
    "Dime el nombre de la variable donde va la API key y la reviso en el código.",
    "¿Cómo se llama la variable de la clave en este proyecto?",
    "Si quieres que lo configure, dime «procede» y sigo con el cambio.",
    "Dime si la clave ya está puesta en el .env y sigo desde ahí.",
    "Las API keys se guardan en el .env y nunca deben compartirse en el chat.",
    "Nunca me pases tu contraseña por el chat; colócala tú mismo en el .env.",
    "El archivo app.py lee la clave desde las variables de entorno al arrancar y, si falta, usa la respuesta de respaldo.",
    "Revisé el endpoint y la respuesta quedó lista. Propongo como siguiente paso confirmar las variables en producción.",
  ];
  for (const text of negatives) {
    const r = redirectCredentialSolicitations(text);
    assert.equal(r.count, 0, `sin detección: «${text.slice(0, 50)}…»`);
    assert.strictEqual(r.text, text, "sin detección el texto sale byte a byte");
    assert.equal(credentialSolicitationIn(text), false);
  }
});

// ------------------------------------------------------------ (A3)
test("(A3) el reemplazo no rompe el resto del texto: vecinos intactos y rachas colapsadas", () => {
  const text = "Ya revisé el endpoint y el catálogo está completo. Pásame tu token de acceso. Dame también la contraseña del panel. Con eso cierro la configuración y verifico el preview.";
  const r = redirectCredentialSolicitations(text);
  assert.equal(r.count, 2, "dos frases solicitantes seguidas");
  assert.ok(r.text.includes("Ya revisé el endpoint y el catálogo está completo."), "la frase inicial sobrevive literal");
  assert.ok(r.text.includes("Con eso cierro la configuración y verifico el preview."), "la frase final sobrevive literal");
  assert.equal((r.text.match(/Coloca ese valor tú mismo/g) || []).length, 1, "la racha de solicitudes colapsa en UNA redirección, no se repite");
  assert.ok(!r.text.includes("Pásame tu token"), "ninguna frase solicitante sobrevive");
  assert.ok(!r.text.includes("Dame también la contraseña"), "ninguna frase solicitante sobrevive");
});

// ------------------------------------------------------------ (A4)
test("(A4) integración: el cierre del turno redirige la solicitud, lo asienta en steps y los hechos lo recogen", async () => {
  const root = emptyProject({ "package.json": PKG, "app.py": appPy() });
  const captures = [];
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "conecta el asesor con la IA configurada en el .env",
    projectRoot: root, threadId: "hilo-v518-a4",
    helpers: scriptedHelpers([
      { text: "Para configurarlo necesito la clave. Si me dices el valor de AI_API_KEY, lo configuro y pruebo de inmediato.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  assert.ok(!String(res.text).includes("me dices el valor"), "la solicitud no llega al usuario");
  assert.ok(String(res.text).includes("bóveda"), "la redirección segura llega al usuario");
  assert.ok(String(res.text).includes("Higiene de credenciales (kernel)"), "el hecho queda declarado al pie del cierre");
  const marker = (res.steps || []).find((s) => s.name === "credential_solicitation_redirected");
  assert.ok(marker, "el marcador queda asentado en los steps del turno");
  assert.equal(marker.result?.redirected, 1);
  const facts = buildKernelFactSummary(res.steps || []);
  assert.ok(facts.includes("Higiene de credenciales"), "los hechos del kernel recogen la redirección desde los steps");
  assert.ok(facts.includes("solicitud(es) de valor de credencial redirigida(s)"), "la línea de hechos es determinista");
});

// ------------------------------------------------------------ (B0)
test("(B0) el bloque «Ya conocido» puro: artefactos + leídos, con tope y vacío sin datos", () => {
  const block = buildThreadKnownBlock(
    { files: ["app.py"], identifiers: [{ name: "_call_ai_service", file: "app.py" }] },
    [{ file: "app.py", ranges: [[1, 0]], size: 441, totalLines: 60, at: 5 }],
  );
  assert.ok(block.includes("YA CONOCIDO EN ESTE HILO"), "lleva el encabezado-orden");
  assert.ok(block.includes("`_call_ai_service` se define en `app.py`"), "el identificador resuelto (S2) nombra su archivo");
  assert.ok(block.includes("`app.py` ya leído en este hilo"), "el archivo leído del hilo se declara");
  assert.ok(block.includes("force:true"), "declara la vía de relectura exacta");
  assert.ok(block.length <= 600, `el bloque cabe en su tope (fueron ${block.length})`);
  assert.strictEqual(buildThreadKnownBlock({ files: [], identifiers: [] }, []), "", "sin datos no hay bloque");
  assert.strictEqual(buildThreadKnownBlock(null, null), "", "entradas nulas no rompen ni inventan bloque");
});

// ------------------------------------------------------------ (B1)
test("(B1) dentro del turno EXECUTE: releer OTRO rango del mismo archivo devuelve el stub del hilo", async () => {
  const root = emptyProject({ "package.json": PKG, "app.py": appPy() });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "corrige app.py: conecta el asesor con la IA configurada en el .env y verifica que responde",
    projectRoot: root, threadId: "hilo-v518-b1",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py", startLine: 1, endLine: 10 })], usage: USAGE },
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py", startLine: 40, endLine: 60 })], usage: USAGE },
      { text: "Revisé app.py desde lo ya conocido del hilo y el frente queda identificado. Propongo como siguiente paso conectar el endpoint y verificarlo con el preview.", toolCalls: [], usage: USAGE },
    ]),
  });
  const reads = (res.steps || []).filter((s) => s.name === "read_file");
  assert.equal(reads.length, 2, "el turno registró sus dos lecturas");
  assert.ok(String(reads[0].result?.content || "").includes("MARCA_LINEA_5"), "la primera lectura es real y trae su rango");
  assert.equal(reads[1].result?.threadReadStub, true, "la segunda lectura (otro rango, mismo archivo, mismo turno) es el stub del hilo");
  assert.equal(reads[1].result?.content, undefined, "el stub no repite contenido");
  assert.ok(String(reads[1].result?.note || "").includes("force:true"), "el stub declara la vía de escape");
  assert.ok(String(reads[1].result?.note || "").includes("este hilo"), "el stub declara que la cobertura es del hilo");
});

// ------------------------------------------------------------ (B2)
test("(B2) tras escribir el archivo, la relectura es REAL (la escritura invalida el índice)", async () => {
  const root = emptyProject({ "package.json": PKG, "app.py": appPy() });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "corrige la línea de la clave en app.py y confirma releyendo",
    projectRoot: root, threadId: "hilo-v518-b2",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py" })], usage: USAGE },
      // Evidencia ANTES de escribir (compuerta de reparación): el
      // build en verde es el paso de evidencia del turno.
      { text: "", toolCalls: [toolCall("run_command", { command: "npm run build" })], usage: USAGE },
      { text: "", toolCalls: [toolCall("replace_in_file", { path: "app.py", oldText: "# relleno 20", newText: "# relleno 20 corregido MARCA_NUEVA" })], usage: USAGE },
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py" })], usage: USAGE },
      { text: "Corregí la línea y confirmé el contenido nuevo releyendo el archivo. Propongo como siguiente paso correr la verificación del proyecto.", toolCalls: [], usage: USAGE },
    ]),
  });
  const reads = (res.steps || []).filter((s) => s.name === "read_file");
  assert.equal(reads.length, 2);
  const last = reads[reads.length - 1];
  assert.notEqual(last.result?.threadReadStub, true, "tras la escritura no hay stub del hilo");
  assert.notEqual(last.result?.alreadyReadInConversation, true, "tras la escritura tampoco manda el comprobante viejo");
  assert.ok(String(last.result?.content || "").includes("MARCA_NUEVA"), "la relectura trae el contenido NUEVO de disco");
});

// ------------------------------------------------------------ (B3)
test("(B3) force:true siempre produce la lectura real, aunque el archivo esté en el índice", async () => {
  const root = emptyProject({ "package.json": PKG, "app.py": appPy() });
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "revisa app.py por rangos y confirma el servicio de IA",
    projectRoot: root, threadId: "hilo-v518-b3",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py", startLine: 1, endLine: 10 })], usage: USAGE },
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py", startLine: 40, endLine: 60, force: true })], usage: USAGE },
      { text: "Confirmé el servicio en su rango con la lectura forzada. Propongo como siguiente paso conectar el endpoint del asesor.", toolCalls: [], usage: USAGE },
    ]),
  });
  const reads = (res.steps || []).filter((s) => s.name === "read_file");
  assert.equal(reads.length, 2);
  assert.notEqual(reads[1].result?.threadReadStub, true, "con force:true no hay stub");
  assert.ok(String(reads[1].result?.content || "").includes("MARCA_LINEA_50"), "la lectura forzada trae el contenido real del rango pedido");
});

// ------------------------------------------------------------ (B4)
test("(B4) el caso en vivo, entre turnos: la continuación EXECUTE no re-paga el archivo y su apertura lleva el bloque", async () => {
  const root = emptyProject({ "package.json": PKG, "app.py": appPy() });
  const threadId = "hilo-v518-b4";
  // Turno 1: el hilo mapea app.py entero.
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "revisa app.py completo y dime cómo lee la clave y dónde está el servicio de IA",
    projectRoot: root, threadId,
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py" })], usage: USAGE },
      { text: "Mapeé app.py: la clave se lee arriba y el servicio de IA está más abajo. Propongo como siguiente paso conectar el endpoint cuando las variables estén en el .env.", toolCalls: [], usage: USAGE },
    ]),
  });
  assert.ok(threadMemory.findThreadRead(root, threadId, "app.py"), "el índice del hilo registró la lectura del turno 1");
  // Turno 2 (continuación): pide OTRO rango del mismo archivo.
  const captures = [];
  const res2 = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "ya está la api en el env: conecta _call_ai_service de app.py con la IA configurada",
    projectRoot: root, threadId,
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py", startLine: 40, endLine: 60 })], usage: USAGE },
      { text: "Conecté el servicio desde lo ya conocido del hilo. Propongo como siguiente paso probar el endpoint con una pregunta real en el preview.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  const read2 = (res2.steps || []).find((s) => s.name === "read_file");
  assert.equal(read2.result?.threadReadStub, true, "la relectura entre turnos (otro rango) es el stub del hilo, no otra exploración pagada");
  assert.equal(read2.result?.content, undefined, "el contenido no vuelve a entrar");
  const opening = JSON.stringify(captures[0]?.messages || []);
  assert.ok(opening.includes("YA CONOCIDO EN ESTE HILO"), "la apertura EXECUTE de la continuación lleva el bloque del hilo");
  assert.ok(opening.includes("`app.py` ya leído en este hilo"), "el bloque nombra el archivo ya mapeado");
  assert.ok(tokenHarness.threadReadStub(root, threadId, "app.py"), "el harness sigue ofreciendo el stub con el archivo sin cambios");
});

// ------------------------------------------------------------ (B5)
test("(B5) en ASK no hay stub del hilo ni bloque de apertura: el carril queda intacto", async () => {
  const root = emptyProject({ "package.json": PKG, "app.py": appPy() });
  const threadId = "hilo-v518-b5";
  // El hilo ya tiene app.py leído (turno de tarea).
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "revisa app.py completo y registra cómo está el servicio de IA",
    projectRoot: root, threadId,
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py" })], usage: USAGE },
      { text: "Ya quedó mapeado app.py en este hilo. Propongo como siguiente paso conectar el endpoint del asesor.", toolCalls: [], usage: USAGE },
    ]),
  });
  assert.ok(threadMemory.findThreadRead(root, threadId, "app.py"), "el índice existe antes de la pregunta");
  const captures = [];
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "¿dónde se lee la clave de la IA en app.py?",
    projectRoot: root, threadId,
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py", startLine: 40, endLine: 60 })], usage: USAGE },
      { text: "La función _call_ai_service envía el mensaje a la IA configurada y devuelve su respuesta; si no hay clave definida, el endpoint cae a la respuesta de respaldo.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  const payload = JSON.stringify(captures[0]?.messages || []);
  assert.ok(!payload.includes("YA CONOCIDO EN ESTE HILO"), "la apertura ASK NO lleva el bloque del hilo");
  for (const s of (res.steps || []).filter((x) => x.name === "read_file")) {
    assert.notEqual(s.result?.threadReadStub, true, "en ASK ninguna lectura es stub del hilo (B1 es solo EXECUTE)");
  }
});
