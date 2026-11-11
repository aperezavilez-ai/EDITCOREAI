"use strict";

// [EDITCORE-INTEGRAL-B5] PERMISOS QUE NO ROMPEN EL FLUJO (Bloque 5 de la
// corrección integral v4.9.0). Conductas probadas con costuras/fakes
// inyectados (callChat guionado, scripts-marcador en disco), sin red:
//  (a) el «procede» viaja como DATO (planAuthorized del renderer /
//      planAuthorizedExecution del kernel) hasta la compuerta: en step,
//      tras UN «procede», la escritura se ejecuta a la primera y sin
//      depender de ninguna forma del texto transformado; sin el dato,
//      la compuerta sigue pidiendo autorización (garantía v4.7.5).
//  (b) el modo efectivo es una sola verdad (normalización única) y un
//      chat NUEVO en modo restrictivo heredado lo ANUNCIA en la
//      primera línea del primer turno; en acceso completo, no.
//  (c) TODA herramienta ofrecida por el kernel tiene clase en
//      classify.js: invoke_subagent = ESCRITURA (la compuerta la corta
//      en solo lectura con blockedReadOnly) y delegate_parallel =
//      LECTURA (pasa también en solo lectura).
//      Nota Bloque 10: las listas de classify conservan nombres
//      clasificados SIN definición ofrecida (project_discovery,
//      delete_file, create_pdf, …): son fantasmas del Bloque 10 y NO
//      se «arreglan» aquí clasificando ni desclasificando nada más.
//  (d) el ANALYZE profundo pasa por la misma autorización que
//      run_command: en solo lectura (y en step sin autorizar) ningún
//      script del proyecto se ejecuta y la omisión se DECLARA; con
//      autorización, los chequeos corren. El stub del verifier
//      (.next/types) sigue la misma regla de escritura.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b5-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const classify = require("../editcore-chat-kernel/classify");
const tools = require("../editcore-chat-kernel/tools");
const { handleChatKernel } = require("../runtime/chat-kernel-bridge");
const { runVerifier, ensureNextTypesStub } = require("../editcore-chat-kernel/subagents/verifier");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-b5-proj-"));
}

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// El prompt EXACTO que el renderer produce al transformar el «procede»
// (project-analysis.js): empieza «AUTORIZACION DE EJECUCION…» y la
// palabra «procede» NO aparece como mensaje suelto del usuario.
const TRANSFORMED_PROMPT = "AUTORIZACION DE EJECUCION: crea el archivo saludo.txt con el contenido del plan presentado al usuario.";

function scriptedHelpers(script) {
  return { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } };
}

function writeScript() {
  return [
    { text: "", toolCalls: [toolCall("write_file", { path: "saludo.txt", content: "hola\n" })], usage: {} },
    { text: "Listo: cree saludo.txt con el contenido pedido y quedo aplicado en el proyecto.", toolCalls: [], usage: {} },
  ];
}

async function runTransformedTurn(extra) {
  const root = tmpProject();
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: TRANSFORMED_PROMPT,
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    history: [
      { role: "user", content: "crea un archivo saludo.txt" },
      { role: "assistant", content: "Voy a crear saludo.txt. ¿Procedo?" },
    ],
    permissionMode: "step",
    allowWrite: true,
    fullAccess: false,
    helpers: scriptedHelpers(writeScript()),
    ...extra,
  });
  return { root, out };
}

// ---------------------------------------------------------------- (a)
test("B5-a1 «procede» como DATO (nombre del renderer: planAuthorized): la escritura se ejecuta a la primera en step", async () => {
  const { root, out } = await runTransformedTurn({ planAuthorized: true });
  assert.equal(fs.readFileSync(path.join(root, "saludo.txt"), "utf8"), "hola\n", "el archivo se escribió en el primer turno autorizado");
  const needsAuth = (out.steps || []).filter((s) => s.result && s.result.needsAuthorization);
  assert.equal(needsAuth.length, 0, "ningún paso volvió a pedir autorización: no hay segundo «procede» ni bucle");
});

test("B5-a2 «procede» como DATO (nombre del kernel: planAuthorizedExecution): mismo resultado", async () => {
  const { root, out } = await runTransformedTurn({ planAuthorizedExecution: true });
  assert.equal(fs.existsSync(path.join(root, "saludo.txt")), true);
  assert.equal((out.steps || []).filter((s) => s.result && s.result.needsAuthorization).length, 0);
});

test("B5-a3 SIN el dato (mismo prompt transformado): la compuerta sigue pidiendo «procede» — la garantía determinista no se toca", async () => {
  const { root, out } = await runTransformedTurn({});
  assert.equal(fs.existsSync(path.join(root, "saludo.txt")), false, "sin autorización como dato no se escribe");
  assert.equal((out.steps || []).filter((s) => s.result && s.result.needsAuthorization).length, 1, "la compuerta corta una vez con needsAuthorization");
});

test("B5-a4 la ruta del BRIDGE normaliza el dato: planAuthorized (renderer) llega al kernel y la escritura pasa", async () => {
  const root = tmpProject();
  const out = await handleChatKernel({
    message: TRANSFORMED_PROMPT,
    history: [
      { role: "user", content: "crea un archivo saludo.txt" },
      { role: "assistant", content: "Voy a crear saludo.txt. ¿Procedo?" },
    ],
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    allowWrite: true,
    permissionMode: "step",
    fullAccess: false,
    // El nombre que la ruta agent:run del renderer realmente manda:
    planAuthorized: true,
    helpers: scriptedHelpers(writeScript()),
  });
  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(path.join(root, "saludo.txt"), "utf8"), "hola\n", "el bridge entregó la autorización como dato y el kernel escribió a la primera");
});

// ---------------------------------------------------------------- (c)
test("B5-c1 invariante de clasificación total: toda definición ofrecida por el kernel está clasificada", () => {
  const offered = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true }).map((d) => d.function?.name).filter(Boolean);
  assert.ok(offered.length >= 30, "el kernel ofrece su catálogo completo");
  for (const name of offered) {
    const classified = classify.READ_ONLY_TOOLS.includes(name) || classify.WRITE_TOOLS.includes(name);
    assert.ok(classified, `la herramienta ofrecida «${name}» debe tener clase en classify.js (lectura o escritura)`);
  }
  assert.ok(classify.WRITE_TOOLS.includes("invoke_subagent"), "invoke_subagent es ESCRITURA (el implementer muta desde B1)");
  assert.ok(classify.READ_ONLY_TOOLS.includes("delegate_parallel"), "delegate_parallel es LECTURA (solo lectura por construcción)");
  assert.ok(!classify.WRITE_TOOLS.includes("delegate_parallel"), "delegate_parallel no es escritura");
});

test("B5-c2 la compuerta corta invoke_subagent en solo lectura (blockedReadOnly) y delegate_parallel pasa como lectura", async () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, "a.txt"), "contenido a\n");
  const script = [
    {
      text: "",
      toolCalls: [
        toolCall("invoke_subagent", { role: "implementer", task: "crea x.txt", patches: [{ path: "x.txt", content: "x" }] }),
        toolCall("delegate_parallel", { tasks: [{ role: "explorer", target: "." }] }),
      ],
      usage: {},
    },
    { text: "Resumen de lo explorado en el proyecto y de lo que este modo de permisos no permite delegar para escribir.", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: false },
    message: "delega la creacion y explora en paralelo",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    allowWrite: false,
    maxSteps: 5,
    permissionMode: "readonly",
    helpers: scriptedHelpers(script),
  });
  const invoke = (out.steps || []).find((s) => s.name === "invoke_subagent");
  const delegate = (out.steps || []).find((s) => s.name === "delegate_parallel");
  assert.ok(invoke, "el paso invoke_subagent quedó registrado");
  assert.equal(invoke.result.blockedReadOnly, true, "invoke_subagent cortado por la compuerta con blockedReadOnly en solo lectura");
  assert.equal(fs.existsSync(path.join(root, "x.txt")), false, "el implementer delegado no escribió nada");
  assert.ok(delegate, "el paso delegate_parallel quedó registrado");
  assert.equal(delegate.ok, true, "delegate_parallel (lectura) SÍ corre en solo lectura");
  assert.notEqual(delegate.result?.blockedReadOnly, true);
});

// ---------------------------------------------------------------- (d)
function forensicProject() {
  const root = tmpProject();
  // Script-marcador: si CUALQUIER chequeo con ejecución corre (test o
  // typecheck), el script deja EXECUTED.txt en el proyecto.
  fs.writeFileSync(path.join(root, "marker.js"), "require(\"fs\").writeFileSync(require(\"path\").join(__dirname, \"EXECUTED.txt\"), \"ran\");\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node marker.js", typecheck: "node marker.js" } }));
  fs.writeFileSync(path.join(root, "index.js"), "const x = 1;\nmodule.exports = x;\n");
  return root;
}

test("B5-d1 ANALYZE profundo en SOLO LECTURA: ningún script se ejecuta y el resultado declara la omisión", async () => {
  const root = forensicProject();
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "hazme un analisis forense profundo del proyecto",
    projectRoot: root,
    permissionMode: "readonly",
    allowWrite: false,
    history: [],
  });
  assert.equal(out.kind, "ANALYZE");
  assert.equal(fs.existsSync(path.join(root, "EXECUTED.txt")), false, "ni npm test ni typecheck corrieron en solo lectura");
  assert.match(String(out.text || ""), /Chequeos con ejecución omitidos en modo solo lectura/, "la omisión se declara en el resultado visible");
});

test("B5-d2 ANALYZE profundo en STEP sin autorizar: tampoco se ejecuta y se declara; con la autorización como dato, los chequeos SÍ corren", async () => {
  const rootSin = forensicProject();
  const orchSin = new ChatOrchestrator();
  const outSin = await orchSin.handle({
    message: "hazme un analisis forense profundo del proyecto",
    projectRoot: rootSin,
    permissionMode: "step",
    allowWrite: true,
    history: [],
  });
  assert.equal(fs.existsSync(path.join(rootSin, "EXECUTED.txt")), false, "en step sin autorización los scripts quedan para cuando el usuario autorice");
  assert.match(String(outSin.text || ""), /Chequeos con ejecución omitidos en modo paso a paso sin autorización/);

  const rootCon = forensicProject();
  const orchCon = new ChatOrchestrator();
  const outCon = await orchCon.handle({
    message: "hazme un analisis forense profundo del proyecto",
    projectRoot: rootCon,
    permissionMode: "step",
    allowWrite: true,
    planAuthorized: true,
    history: [],
  });
  assert.equal(fs.existsSync(path.join(rootCon, "EXECUTED.txt")), true, "con autorización, los chequeos con ejecución corren como siempre");
  assert.doesNotMatch(String(outCon.text || ""), /Chequeos con ejecución omitidos/);
});

test("B5-d3 el stub del verifier sigue la misma regla: sin autorización no se escribe; con autorización, sí", async () => {
  const mkNextProject = () => {
    const root = tmpProject();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "nextdemo", scripts: { typecheck: "node marker.js" } }));
    fs.writeFileSync(path.join(root, "marker.js"), "require(\"fs\").writeFileSync(require(\"path\").join(__dirname, \"EXECUTED.txt\"), \"ran\");\n");
    fs.writeFileSync(path.join(root, "next-env.d.ts"), "/// <reference path=\"./.next/types/routes.d.ts\" />\n");
    return root;
  };
  const stubPath = (root) => path.join(root, ".next", "types", "routes.d.ts");

  // La función del stub, directa: allowWrite:false = no toca disco.
  const rootFn = mkNextProject();
  assert.equal(ensureNextTypesStub(rootFn, { allowWrite: false }), false);
  assert.equal(fs.existsSync(stubPath(rootFn)), false, "sin autorización el stub no se escribe");
  assert.equal(ensureNextTypesStub(rootFn), true, "con autorización el stub se escribe como siempre");
  assert.equal(fs.existsSync(stubPath(rootFn)), true);

  // El verifier completo sin autorización de ejecución: ni el comando
  // ligero ni los tests corren, el stub no aparece y la omisión se declara.
  const rootV = mkNextProject();
  const res = await runVerifier({ projectRoot: rootV, allowExecution: false, allowWrite: false });
  assert.equal(fs.existsSync(path.join(rootV, "EXECUTED.txt")), false, "el verifier no ejecutó ningún script sin autorización");
  assert.equal(fs.existsSync(stubPath(rootV)), false, "el verifier no escribió el stub sin autorización");
  assert.equal(res.executionOmitted, true, "el resultado del verifier declara la omisión de ejecución");
});

// ---------------------------------------------------------------- (b)
test("B5-b1 chat NUEVO en proyecto en solo lectura: el anuncio de modo abre el primer turno (primera línea y onProgress)", async () => {
  const root = tmpProject();
  const progress = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "crea un archivo prueba.txt en la raiz del proyecto",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    permissionMode: "readonly",
    allowWrite: false,
    isNewChat: true,
    onProgress: (p) => progress.push(p),
    runModelTaskFn: async () => ({ kind: "EXECUTE", text: "respuesta del turno", steps: [] }),
  });
  const firstLine = String(out.text || "").split("\n")[0];
  assert.match(firstLine, /Modo de este chat: Solo lectura/, "la primera línea visible del primer turno anuncia el modo");
  assert.match(firstLine, /Permisos/, "el anuncio dice cómo cambiarlo");
  assert.ok(progress.some((p) => /Modo de este chat: Solo lectura/.test(String(p.text || ""))), "el anuncio también se emite al abrir el turno por onProgress");
  assert.equal(out.modeAnnouncement, out.text.split("\n\n")[0], "el resultado expone el anuncio como dato");
});

test("B5-b2 sin anuncio: acceso completo en chat nuevo, y solo lectura en chat que YA tiene historial", async () => {
  const root = tmpProject();
  const capture = async () => ({ kind: "EXECUTE", text: "respuesta del turno", steps: [] });

  const orchFull = new ChatOrchestrator();
  const outFull = await orchFull.handle({
    message: "crea un archivo prueba.txt en la raiz del proyecto",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    isNewChat: true,
    runModelTaskFn: capture,
  });
  assert.doesNotMatch(String(outFull.text || ""), /Modo de este chat/, "en acceso completo no hay nada restrictivo que anunciar");

  const orchOld = new ChatOrchestrator();
  const outOld = await orchOld.handle({
    message: "crea un archivo prueba.txt en la raiz del proyecto",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    permissionMode: "readonly",
    allowWrite: false,
    // sin isNewChat: el chat ya existía, su modo ya se anunció al abrirlo
    runModelTaskFn: capture,
  });
  assert.doesNotMatch(String(outOld.text || ""), /Modo de este chat/, "el anuncio es solo al abrir un chat nuevo, no en cada turno");
});

test("B5-b3 modo efectivo ÚNICO: la normalización converge los alias y el defecto inválido a «step» en todas las capas", () => {
  assert.equal(classify.normalizePermissionMode("solo lectura"), "readonly");
  assert.equal(classify.normalizePermissionMode("read-only"), "readonly");
  assert.equal(classify.normalizePermissionMode("full"), "full");
  assert.equal(classify.normalizePermissionMode("step"), "step");
  assert.equal(classify.normalizePermissionMode("valor-invalido"), "step", "ante un valor inválido se cae a step (el mismo defecto de main y del renderer)");
  assert.equal(classify.normalizePermissionMode(""), "step");
  // El constructor del anuncio usa la misma normalización:
  assert.match(classify.buildModeAnnouncement({ permissionMode: "solo-lectura", isNewChat: true }), /Solo lectura/);
  assert.match(classify.buildModeAnnouncement({ permissionMode: "step", isNewChat: true }), /Pregunta antes/);
  assert.equal(classify.buildModeAnnouncement({ permissionMode: "step", isNewChat: false }), "");
});
