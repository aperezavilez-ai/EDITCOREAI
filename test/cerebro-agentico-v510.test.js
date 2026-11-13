"use strict";

// [EDITCORE-V510] FASE B — CEREBRO AGÉNTICO (v5.1.0). Una prueba por
// pieza del paquete único, con el patrón de la Fase A (proyectos
// temporales, proveedor falso guionizado, sin red):
//  (B1)  consulta con el motor ocupado ⇒ la atiende el CONSERJE sin
//        entrar en la cadena ni escribir archivos; cancelable sola.
//  (B1b) una entrada vencida NO se descarta (se funde como steering)
//        y el aviso de sistema produce 0 tokens estimados.
//  (B2)  un turno que cierra con solo «Listo la carpeta.» fuerza la
//        síntesis; si ni así responde, constancia desde los hechos.
//  (B3)  un turno que ESCRIBIÓ y cierra pelado recibe el empujón de
//        cierre propositivo; el respaldo declara el término desde
//        los hechos (nextStepsClosingText).
//  (B4)  tras N pasos de solo lectura el libro del harness dispara
//        la rendición y totalUsage separa aplicados / en vueltas.
//  (B5)  un subagente RECIBE el bloque de memoria compartida y su
//        informe queda destilado en el expediente con procedencia;
//        el destilado del cierre (brainRemember) son hechos, no relato.
//  (B6)  la detección marca un turno descomponible (paso del
//        director + red en el bucle), el rol writer con ámbitos
//        pisados se rechaza y con ámbitos disjuntos se acepta, sin
//        tope numérico de tareas.
//  (B7)  un cierre con verificación fallida registra FRACASO en la
//        red de agentes (veredicto real), no éxito fijo.
//  (Mapa i)   un turno que cierra con una decisión la deja en la capa
//             del proyecto del Mapa y el turno siguiente la trae en
//             su bloque esencial.
//  (Mapa ii)  una decisión contradictoria REEMPLAZA la anterior
//             conservando la procedencia, sin duplicar.
//  (Mapa iii) el payload del conserje incluye el bloque del Mapa.
//  (Mapa iv)  una pregunta de orientación se responde con la entrada
//             del Mapa primero (search_brain), sin lecturas del disco.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v510-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
// La capa USUARIO del Mapa vive en ~/.editcore: HOME temporal.
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
// La red de agentes persiste donde diga la env (leída al cargar el
// módulo): archivo temporal propio para la prueba B7.
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

// Visión falsa (render OK) instalada ANTES de cargar el orquestador,
// como en la batería de la Fase A.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const vision = require("../editcore-chat-kernel/vision-inspector");
vision.capture_preview_screenshot = async (opts = {}) => {
  const root = opts.projectRoot || process.cwd();
  const dir = path.join(root, ".editcore", "vision");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, "preview-fake-v510.png");
  fs.writeFileSync(abs, PNG_BYTES);
  return {
    ok: true, engine: "fake-v510", url: opts.url || "http://127.0.0.1:5442/",
    viewport: opts.viewport || "desktop",
    screenshotPath: ".editcore/vision/preview-fake-v510.png", screenshotAbs: abs,
    screenshotBytes: PNG_BYTES.length,
    diagnostics: { issues: [], consoleErrors: [], renderOk: true, headings: ["Proyecto"] },
    renderOk: true,
  };
};

const { ChatOrchestrator, appendRealVerification } = require("../editcore-chat-kernel/orchestrator");
const kernelIndex = require("../editcore-chat-kernel/index");
const tools = require("../editcore-chat-kernel/tools");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const { runConcierge } = require("../editcore-chat-kernel/concierge");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const { distillTurnForBrain } = require("../editcore-chat-kernel/subagent-distill");
const { validateDelegateTasks } = require("../editcore-chat-kernel/parallel-delegate");
const { normalizeProviderUsage } = require("../usage-metrics");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedHelpers(script, snapshots) {
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      if (snapshots) snapshots.push(JSON.stringify(args?.messages || []));
      return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
    },
  };
  return { helpers, count: () => calls };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v510-proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function waitFor(fn, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await new Promise((res) => setTimeout(res, 15));
  }
  return fn();
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

// ---------------------------------------------------------------- B1
test("B1: con el motor ocupado, una consulta pura la atiende el conserje sin entrar en la cadena ni escribir archivos", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  const listingBefore = JSON.stringify(fs.readdirSync(path.join(root, "src")));
  const gate = deferred();
  let mainCalls = 0;
  const mainPromise = kernelIndex.handleChat({
    runId: "v510-b1-main", chatId: "chat-main",
    message: "crea el archivo principal.txt con un saludo",
    projectRoot: root, apiBaseUrl: BASE_ARGS.apiBaseUrl, apiKey: "k", model: "m",
    helpers: { callChat: async () => { mainCalls += 1; return gate.promise; } },
  });
  assert.ok(await waitFor(() => mainCalls >= 1), "el turno principal está bloqueado en el proveedor");

  const query = { message: "lista los archivos de este proyecto" };
  assert.equal(kernelIndex.isPureKernelQuery(query), true, "precondición: la consulta es pura (LIST, sin mutación)");
  const answer = await kernelIndex.handleChat({
    runId: "v510-b1-query", chatId: "chat-query",
    message: query.message,
    projectRoot: root, apiBaseUrl: BASE_ARGS.apiBaseUrl, apiKey: "k", model: "m",
    helpers: {
      callChat: async () => ({ text: "En el proyecto hay la carpeta src y el archivo package.json en la raíz.", toolCalls: [], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } }),
    },
  });
  assert.equal(answer.kind, "CONCIERGE", "la consulta resolvió por el carril del conserje");
  assert.equal(answer.concierge, true);
  assert.match(answer.text, /package\.json/);
  assert.equal(answer.runId, "v510-b1-query");
  assert.equal(JSON.stringify(fs.readdirSync(path.join(root, "src"))), listingBefore, "el conserje no escribió ni creó nada");
  assert.equal(fs.existsSync(path.join(root, "principal.txt")), false, "el turno principal sigue sin terminar: la consulta no lo suplantó");

  gate.resolve({ text: "Listo, quedó creado principal.txt.", toolCalls: [], usage: {} });
  const main = await mainPromise;
  assert.equal(main.runId, "v510-b1-main", "el turno principal completó intacto después");
});

test("B1: cancelar la corrida del conserje no toca la corrida principal", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const gate = deferred();
  let mainCalls = 0;
  const mainPromise = kernelIndex.handleChat({
    runId: "v510-b1c-main", chatId: "chat-main",
    message: "crea el archivo otro.txt con un saludo",
    projectRoot: root, apiBaseUrl: BASE_ARGS.apiBaseUrl, apiKey: "k", model: "m",
    helpers: { callChat: async () => { mainCalls += 1; return gate.promise; } },
  });
  assert.ok(await waitFor(() => mainCalls >= 1));

  const queryPromise = kernelIndex.handleChat({
    runId: "v510-b1c-query", chatId: "chat-query",
    message: "lista los archivos de este proyecto",
    projectRoot: root, apiBaseUrl: BASE_ARGS.apiBaseUrl, apiKey: "k", model: "m",
    helpers: {
      // El proveedor del conserje «piensa» hasta que SU señal aborta.
      callChat: (args) => new Promise((resolve) => {
        args.signal?.addEventListener?.("abort", () => resolve({ text: "", toolCalls: [], usage: {} }), { once: true });
      }),
    },
  });
  assert.ok(await waitFor(() => kernelIndex.listChatRuns().some((r) => r.runId === "v510-b1c-query" && r.state === "concierge")), "la consulta corre por el carril del conserje");
  assert.equal(kernelIndex.cancelChatRun("v510-b1c-query"), true);
  const cancelled = await queryPromise;
  assert.equal(cancelled.cancelled, true, "la corrida del conserje resolvió cancelada");
  gate.resolve({ text: "Listo.", toolCalls: [], usage: {} });
  const main = await mainPromise;
  assert.notEqual(main.cancelled, true, "la corrida principal ni se enteró de la cancelación ajena");
});

// --------------------------------------------------------------- B1b
test("B1b: la entrada vencida se funde como steering (no se descarta) y el aviso de sistema estima 0 tokens", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const gate = deferred();
  let mainCalls = 0;
  let secondCalls = 0;
  const mainPromise = kernelIndex.handleChat({
    runId: "v510-b1b-main", chatId: "chat-main",
    message: "crea el archivo base.txt con un saludo",
    projectRoot: root, apiBaseUrl: BASE_ARGS.apiBaseUrl, apiKey: "k", model: "m",
    helpers: { callChat: async () => { mainCalls += 1; return gate.promise; } },
  });
  assert.ok(await waitFor(() => mainCalls >= 1));

  const second = await kernelIndex.handleChat({
    runId: "v510-b1b-second", chatId: "chat-second",
    message: "agrega también un pie de página con el año al final del sitio",
    projectRoot: root, apiBaseUrl: BASE_ARGS.apiBaseUrl, apiKey: "k", model: "m",
    queueTimeoutMs: 60,
    helpers: { callChat: async () => { secondCalls += 1; return { text: "no debería ejecutarse", toolCalls: [], usage: {} }; } },
  });
  assert.equal(second.kind, "STEERED", "la instrucción vencida se fundió en el turno en curso");
  assert.equal(second.steered, true);
  assert.equal(secondCalls, 0, "nunca llegó al proveedor como turno propio");
  // El aviso es texto de SISTEMA: normalizeProviderUsage no estima ni
  // un token sobre él (el caso ↓75: 297 caracteres ÷ 4).
  const estimate = (t) => Math.ceil(String(t || "").length / 4);
  const marked = normalizeProviderUsage(second.usage, 500, second.text, estimate);
  assert.equal(marked.estimated_output_tokens, 0, "con la marca de sistema, la estimación de salida es 0");
  assert.equal(marked.estimated_input_tokens, 0);
  assert.equal(marked.telemetry, "system");
  const unmarked = normalizeProviderUsage({}, 500, second.text, estimate);
  assert.ok(unmarked.estimated_output_tokens > 0, "control: sin la marca, el mismo texto SÍ se estimaba (el cobro fantasma existía)");

  gate.resolve({ text: "Listo.", toolCalls: [], usage: {} });
  await mainPromise;
});

// ---------------------------------------------------------------- B2
test("B2: un cierre de pura narración («Listo la carpeta.») fuerza la síntesis sin herramientas", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  // Respondedor dinámico: el mensaje clasifica EXECUTE con intención de
  // mutación, así que tras la síntesis otras compuertas preexistentes
  // (fixWithoutWrites) pueden devolver el turno más veces; la síntesis
  // es la respuesta a todo empuje posterior.
  const SYNTH = "El proyecto es una base mínima: tiene package.json y src/index.js. Propongo agregar una página de contacto y una sección de servicios para que supere a una plantilla pelada.";
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      const lastUser = [...(args.messages || [])].reverse().find((m) => m.role === "user");
      const t = typeof lastUser?.content === "string" ? lastUser.content : "";
      if (t.includes("Tu cierre no es una respuesta")) return { text: SYNTH, toolCalls: [], usage: USAGE };
      if (calls === 1) return { text: "", toolCalls: [toolCall("list_files", { path: "." })], usage: USAGE };
      if (calls === 2) return { text: "Listo la carpeta.", toolCalls: [], usage: USAGE };
      return { text: SYNTH, toolCalls: [], usage: USAGE };
    },
  };
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué podemos mejorar o agregar para que este proyecto sea mejor que otros?",
    projectRoot: root, threadId: "hilo-b2", helpers,
  });
  assert.ok(calls >= 3, "el guardián devolvió el turno: hubo una llamada más tras la narración");
  assert.match(out.text, /Propongo agregar una página de contacto/, "la respuesta final es la síntesis, no la narración");
  assert.doesNotMatch(out.text.trim(), /^Listo la carpeta\.$/);
});

test("B2: si ni con el empujón hay respuesta, el cierre es la constancia determinista desde los hechos", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n" });
  const s = scriptedHelpers([
    { text: "", toolCalls: [toolCall("list_files", { path: "." })], usage: USAGE },
  ]);
  // Todo cierre posterior del guion es la misma narración.
  s.helpers.callChat = async () => ({ text: "Listo la carpeta.", toolCalls: [], usage: USAGE });
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿qué podemos mejorar o agregar para que este proyecto sea mejor que otros?",
    projectRoot: root, threadId: "hilo-b2b", helpers: s.helpers,
  });
  assert.match(out.text, /Cierre del kernel \(el modelo no dejó respuesta sustantiva\)/, "el respaldo determinista declara su origen (kernel, desde los hechos)");
});

// ---------------------------------------------------------------- B3
test("B3: un turno que escribió y cierra pelado recibe el empujón propositivo; con término declarado, cierra", async () => {
  const root = emptyProject({});
  const bareClose = "Ya quedó creado el archivo notas.txt con el saludo que pediste, tal como lo solicitaste en tu mensaje anterior.";
  const snapshots = [];
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      snapshots.push(JSON.stringify(args?.messages || []));
      const lastUser = [...(args.messages || [])].reverse().find((m) => m.role === "user");
      const lastText = typeof lastUser?.content === "string" ? lastUser.content : "";
      if (lastText.includes("No cierres «mocho»")) {
        return { text: "Doy por terminado este encargo porque el archivo notas.txt quedó creado en disco con el saludo pedido.", toolCalls: [], usage: USAGE };
      }
      if (calls === 1) return { text: "", toolCalls: [toolCall("write_file", { path: "notas.txt", content: "Hola, taller.\n" })], usage: USAGE };
      return { text: bareClose, toolCalls: [], usage: USAGE };
    },
  };
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "crea el archivo notas.txt con el saludo",
    projectRoot: root, threadId: "hilo-b3", helpers,
  });
  assert.equal(fs.readFileSync(path.join(root, "notas.txt"), "utf8"), "Hola, taller.\n");
  assert.ok(snapshots.some((snap) => snap.includes("No cierres «mocho»")), "el empujón de cierre propositivo llegó al modelo (con escrituras hechas: la generalización B3)");
  assert.match(out.text, /Doy por terminado este encargo/, "el cierre final trae la declaración de término");
});

test("B3: el respaldo determinista declara el término desde los hechos, no «Cambios aplicados.» pelado", async () => {
  const root = emptyProject({});
  const s = scriptedHelpers([
    { text: "", toolCalls: [toolCall("write_file", { path: "notas.txt", content: "Hola.\n" })], usage: USAGE },
    { text: "Listo.", toolCalls: [], usage: USAGE },
  ]);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "crea el archivo notas.txt con el saludo",
    projectRoot: root, threadId: "hilo-b3b", helpers: s.helpers,
  });
  assert.match(out.text, /Declaro el término de esta tarea desde los hechos: quedaron aplicados 1 archivo\(s\)/, "el respaldo declara el término desde los hechos");
  assert.doesNotMatch(out.text, /Cambios aplicados\.\s*$/, "ya no es el «Cambios aplicados.» pelado");
});

// ---------------------------------------------------------------- B4
test("B4: pasos de solo lectura disparan la rendición del harness y el uso separa aplicados de vueltas", async () => {
  const files = { "package.json": JSON.stringify({ name: "demo" }) };
  for (let n = 1; n <= 30; n += 1) files[`f${String(n).padStart(2, "0")}.txt`] = `contenido ${n}\n`;
  const root = emptyProject(files);
  const snapshots = [];
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      snapshots.push(JSON.stringify(args?.messages || []));
      // Lee un archivo distinto por paso: nunca aplica nada.
      return { text: "", toolCalls: [toolCall("read_file", { path: `f${String(Math.min(calls, 30)).padStart(2, "0")}.txt` })], usage: USAGE };
    },
  };
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "crea la página de contacto del proyecto",
    projectRoot: root, threadId: "hilo-b4", helpers,
  });
  assert.ok(snapshots.some((snap) => snap.includes("RENDICIÓN DE AVANCE")), "el empujón de rendición llegó al modelo tras los pasos sin aplicar");
  assert.match(out.text, /Rendición de avance/, "persistiendo el atoro, el cierre es la rendición determinista del kernel");
  assert.ok(out.usage.idle_step_tokens > 0, "el recibo separa tokens EN VUELTAS");
  assert.equal(out.usage.applied_step_tokens, 0, "ningún token contó como aplicado: no se aplicó nada");
});

// ---------------------------------------------------------------- B5
test("B5: el subagente recibe la memoria compartida y su informe queda destilado en el expediente con procedencia", async () => {
  const root = emptyProject({
    "package.json": JSON.stringify({ name: "demo", scripts: { start: "node src/index.js" } }),
    "README.md": "# Taller demo\n",
    "src/index.js": "console.log('hola');\n",
  });
  threadMemory.noteDecision(root, "El precio del plan Pro queda en $29 al mes");
  const out = await tools.execute("delegate_parallel", {
    tasks: [
      { role: "analyst", question: "¿qué archivos clave tiene este proyecto?" },
      { role: "explorer", target: "src" },
    ],
  }, root, true, { threadId: "hilo-b5" });
  assert.equal(out.ok, true);
  assert.match(out.text, /Memoria compartida/, "el informe del subagente trae la sección de memoria compartida que recibió");
  assert.match(out.text, /\$29/, "la memoria que recibió incluye la decisión del expediente");
  assert.ok(Number(out.memoryRecorded || 0) > 0, "el despacho registró el destilado de vuelta");
  const state = threadMemory.loadProjectState(root);
  assert.ok((state.decisions || []).some((d) => String(d.text || "").includes("subagente analyst")), "la conclusión del analyst quedó en el expediente con procedencia");
  assert.ok((state.facts || []).some((f) => String(f.why || "").includes("subagente")), "los archivos clave mapeados quedaron como hechos con procedencia");
});

test("B5: el destilado del cierre para el Cerebro son hechos del kernel, no el relato", () => {
  const content = distillTurnForBrain({
    userText: "crea la landing",
    steps: [
      { name: "write_file", input: { path: "src/landing.js" }, result: { ok: true }, ok: true },
      { name: "capture_preview_screenshot", input: {}, result: { renderOk: true }, ok: true },
      { name: "run_command", input: { command: "npm run build" }, result: { ok: false, error: "falló el build" }, ok: false },
    ],
    finalText: "Prosa de cierre muy larga que no debe copiarse entera al Cerebro porque es relato y no hechos verificables del turno.",
  });
  assert.match(content, /Aplicado \(hechos del kernel\): src\/landing\.js/);
  assert.match(content, /Verificación visual: 1 captura\(s\) con render OK/);
  assert.match(content, /Descartado\/falló: run_command: falló el build/);
});

// ---------------------------------------------------------------- B6
test("B6: la detección marca el turno descomponible, la red empuja a delegar y los ámbitos del writer se validan", async () => {
  const { detectDecomposableTask } = require("../editcore-chat-kernel/orchestrator");
  const det = detectDecomposableTask("actualiza la landing y el blog de este proyecto");
  assert.equal(det.decomposable, true);
  assert.ok(det.zones.includes("landing") && det.zones.includes("blog"));

  // Sin tope numérico: 6 tareas válidas pasan las 6.
  const many = validateDelegateTasks(Array.from({ length: 6 }, (_, i) => ({ role: "explorer", target: `zona${i}` })));
  assert.equal(many.tasks.length, 6, "sin tope de 4: las 6 tareas válidas se aceptan");
  // Writer con ámbitos pisados: el segundo se rechaza con nota.
  const clash = validateDelegateTasks([
    { role: "writer", target: "src", question: "aplica los parches de src" },
    { role: "writer", target: "src/components", question: "aplica los parches de componentes" },
  ]);
  assert.equal(clash.tasks.length, 1, "el writer pisado se rechaza");
  assert.ok(clash.notes.some((n) => /se pisa/.test(n)), "el rechazo declara la colisión");
  // Writer con ámbitos disjuntos: ambos se aceptan.
  const disjoint = validateDelegateTasks([
    { role: "writer", target: "src", question: "aplica los parches de src" },
    { role: "writer", target: "docs", question: "aplica los parches de docs" },
  ]);
  assert.equal(disjoint.tasks.length, 2, "ámbitos disjuntos: ambos writers aceptados");

  // El turno descomponible lleva el paso del director y la red del
  // bucle empuja a delegar antes de cerrar en serie.
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/index.js": "console.log(1);\n", "f1.txt": "uno\n" });
  const snapshots = [];
  let calls = 0;
  let delegated = false;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      snapshots.push(JSON.stringify(args?.messages || []));
      const lastUser = [...(args.messages || [])].reverse().find((m) => m.role === "user");
      const lastText = typeof lastUser?.content === "string" ? lastUser.content : "";
      // Una sola delegación: tras despachar, el último mensaje de
      // usuario SIGUE siendo el empuje del director (el resultado de
      // la herramienta viaja con rol «tool»), así que sin esta bandera
      // el respondedor delegaría en bucle.
      if (lastText.includes("DIRECTOR:") && !delegated) {
        delegated = true;
        return { text: "", toolCalls: [toolCall("delegate_parallel", { tasks: [{ role: "explorer", target: "src" }] })], usage: USAGE };
      }
      if (calls <= 2) return { text: "", toolCalls: [toolCall("read_file", { path: "f1.txt" })], usage: USAGE };
      return { text: "Con la evidencia reunida cierro el repaso de las dos zonas y doy por terminado este análisis porque ya quedó documentado.", toolCalls: [], usage: USAGE };
    },
  };
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "actualiza la landing y el blog de este proyecto",
    projectRoot: root, threadId: "hilo-b6", helpers,
  });
  assert.ok(out.steps.some((s) => s.name === "director_dispatch"), "la detección quedó asentada en los steps del turno");
  assert.ok(snapshots.some((snap) => snap.includes("DIRECTOR MULTIAGENTE")), "la directiva del director entró en el contexto del turno");
  assert.ok(out.steps.some((s) => s.name === "delegate_parallel"), "la red del director logró el despacho antes del cierre");
});

// ---------------------------------------------------------------- B7
test("B7: appendRealVerification expone el veredicto real (aprobada en el turno / build fallido)", async () => {
  const okRoot = emptyProject({ "src/index.css": "body { margin: 0; }\n" });
  const boxOk = { value: null };
  await appendRealVerification(okRoot, ["src/index.css"], [
    { name: "write_file", input: { path: "src/index.css" }, result: { ok: true }, ok: true },
    { name: "capture_preview_screenshot", input: {}, result: { renderOk: true, diagnostics: { consoleErrors: [] } }, ok: true },
  ], "texto", null, { verdictBox: boxOk });
  assert.equal(boxOk.value, true, "el propio turno verificó de verdad y pasó: veredicto true");

  const failRoot = emptyProject({
    "package.json": JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(1)\"" } }),
    "src/index.css": "body { margin: 0; }\n",
  });
  const boxFail = { value: null };
  await appendRealVerification(failRoot, ["src/index.css"], [
    { name: "write_file", input: { path: "src/index.css" }, result: { ok: true }, ok: true },
  ], "texto", null, { repairTask: true, verdictBox: boxFail });
  assert.equal(boxFail.value, false, "el build falló: veredicto false (no éxito fijo)");
});

test("B7: un cierre con la verificación real fallida registra FRACASO en la red de agentes", async () => {
  const readHistory = () => {
    try { return JSON.parse(fs.readFileSync(process.env.EDITCORE_AGENT_NETWORK_PATH, "utf8")).history || []; }
    catch { return []; }
  };
  const runTurn = async (buildScript) => {
    const root = emptyProject({
      "package.json": JSON.stringify({ name: "demo", scripts: { build: buildScript } }),
    });
    const s = scriptedHelpers([
      { text: "", toolCalls: [toolCall("write_file", { path: "src/index.css", content: "body { color: red; }\n" })], usage: USAGE },
      { text: "Doy por terminado el encargo porque el archivo de estilos quedó creado en disco tal como se pidió.", toolCalls: [], usage: USAGE },
    ]);
    const out = await new ChatOrchestrator().handle({
      ...BASE_ARGS, message: "crea el archivo src/index.css con los estilos base",
      projectRoot: root, threadId: `hilo-b7-${buildScript.includes("exit(1)") ? "fail" : "ok"}`, helpers: s.helpers,
    });
    return out;
  };
  const before = readHistory().length;
  await runTurn("node -e \"process.exit(1)\"");
  await runTurn("node -e \"process.exit(0)\"");
  const history = readHistory().slice(before);
  assert.ok(history.length >= 2, "ambos cierres registraron su resultado en la red");
  assert.equal(history[history.length - 2].success, false, "verificación fallida ⇒ la red registra FRACASO aunque el modelo cerró «terminado»");
  assert.equal(history[history.length - 1].success, true, "verificación aprobada ⇒ la red registra éxito");
});

// ------------------------------------------------------- Mapa (i–iv)
test("Mapa (i): un turno que cierra con una decisión la deja en la capa del proyecto y el turno siguiente la trae en su bloque esencial", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const s1 = scriptedHelpers([
    { text: "Perfecto, queda el plan Pro en $29 al mes.", toolCalls: [], usage: USAGE },
  ]);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "elijo el precio del plan Pro en $29 al mes",
    projectRoot: root, threadId: "hilo-mapa", helpers: s1.helpers,
  });
  const map = orientationMap.getProjectMap(root);
  assert.ok(map.decisions.some((d) => d.text.includes("$29")), "la decisión del turno quedó en la capa del proyecto del Mapa");

  const snapshots = [];
  const s2 = scriptedHelpers([
    { text: "El plan Pro quedó en $29 al mes, como decidiste.", toolCalls: [], usage: USAGE },
  ], snapshots);
  await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "¿en cuánto quedó el plan Pro?",
    projectRoot: root, threadId: "hilo-mapa", helpers: s2.helpers,
  });
  assert.ok(snapshots.some((snap) => snap.includes("MAPA DE ORIENTACIÓN") && snap.includes("$29")), "el turno siguiente trae la decisión en su bloque esencial del Mapa");
});

test("Mapa (ii): una decisión contradictoria reemplaza la anterior conservando la procedencia, sin duplicar", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const turn = async (message) => {
    const s = scriptedHelpers([{ text: "Anotado.", toolCalls: [], usage: USAGE }]);
    await new ChatOrchestrator().handle({ ...BASE_ARGS, message, projectRoot: root, threadId: "hilo-mapa2", helpers: s.helpers });
  };
  await turn("elijo el precio del plan Pro en $29 al mes");
  await turn("elijo el precio del plan Pro en $39 al mes");
  const map = orientationMap.getProjectMap(root);
  const ofTopic = map.decisions.filter((d) => orientationMap.topicKey(d.text) === orientationMap.topicKey("el precio del plan Pro en $39 al mes"));
  assert.equal(ofTopic.length, 1, "una sola entrada vigente para el tema: la nueva sustituyó a la vieja");
  assert.ok(ofTopic[0].text.includes("$39"));
  assert.ok(ofTopic[0].supersedes && ofTopic[0].supersedes.text.includes("$29"), "la procedencia del asiento sustituido se conserva");
});

test("Mapa (iii): el payload del conserje incluye el bloque del Mapa", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  orientationMap.noteMapDecision(root, "El precio del plan Pro queda en $39 al mes", "prueba v5.1.0");
  let payload = null;
  const out = await runConcierge({
    message: "¿qué decidimos del precio del plan Pro?",
    projectRoot: root, threadId: "hilo-mapa3", apiBaseUrl: BASE_ARGS.apiBaseUrl, apiKey: "k", model: "m",
    helpers: {
      callChat: async (args) => {
        payload = JSON.stringify(args.messages || []);
        return { text: "Decidimos que el plan Pro queda en $39 al mes.", toolCalls: [], usage: USAGE };
      },
    },
  });
  assert.ok(out && out.kind === "CONCIERGE");
  assert.ok(payload && payload.includes("MAPA DE ORIENTACIÓN"), "el bloque del Mapa viaja en el payload del conserje");
  assert.ok(payload.includes("$39"), "y trae la decisión vigente");
});

test("Mapa (iv): una pregunta de orientación se responde con la entrada del Mapa primero, sin lecturas de archivos del proyecto", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/secreto.js": "const clave = 1;\n" });
  orientationMap.noteMapDecision(root, "El precio del plan Pro queda en $39 al mes", "prueba v5.1.0");
  const hits = orientationMap.searchMap(root, "¿qué decidimos del precio del plan Pro?");
  assert.ok(hits.length >= 1 && hits[0].kind === "decisión" && hits[0].text.includes("$39"), "la búsqueda del Mapa devuelve primero la decisión vigente");
  const out = await tools.execute("search_brain", { query: "¿qué decidimos del precio del plan Pro?" }, root, true, {});
  assert.equal(out.mapFirst, true, "search_brain marca que el Mapa va primero");
  assert.ok(Array.isArray(out.map) && out.map.some((h) => h.text.includes("$39")), "la entrada del Mapa está en el resultado");
});

test("Mapa: la capa de usuario sustituye reglas contradictorias y el índice de proyectos se sincroniza", async () => {
  orientationMap.upsertUserRule("Las releases se publican los viernes", "prueba v5.1.0");
  orientationMap.upsertUserRule("Las releases se publican los lunes", "prueba v5.1.0");
  const user = orientationMap.getUserMap();
  const releases = user.rules.filter((r) => orientationMap.topicKey(r.text) === orientationMap.topicKey("Las releases se publican los lunes"));
  assert.equal(releases.length, 1, "la regla nueva sustituyó a la contradictoria");
  assert.ok(releases[0].supersedes && releases[0].supersedes.text.includes("viernes"), "con procedencia conservada");
  const block = orientationMap.buildUserMapBlock();
  assert.match(block, /lunes/);
});
