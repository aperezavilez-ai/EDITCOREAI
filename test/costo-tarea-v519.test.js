"use strict";

// Batería v5.1.9 — M4: cortes de costo de los turnos de TAREA tras
// la medición MEDICION-M4 (la sobrecarga fija por llamada — no la
// zona de pasos — pasó a mandar: 65-72 % del turno):
//  (K1) DESCRIPCIONES A PRIMERA FRASE EN EL PAYLOAD: el JSON de
//      definiciones medía 19.340 caracteres por llamada y el 48 %
//      era prosa. La copia que viaja al proveedor lleva cada
//      descripción ceñida a su primera frase; el SET queda intacto
//      (nombres, parámetros y esquemas idénticos — no es la dieta
//      C6 excluida en M3) y las definiciones de origen no se
//      mutan. Byte-estable entre llamadas.
//  (K3) INFORMES DE DELEGACIÓN SIN ECO: el resultado de
//      delegate_parallel que entra al contexto del padre ya no
//      trae el bloque «Memoria compartida» que los subagentes
//      devolvían como eco (78 % del informe medido): el retiro se
//      hace sobre la copia del mensaje, con marca declarada; el
//      step conserva el resultado íntegro y el subagente sigue
//      RECIBIENDO la memoria (B5 de la v5.1.0 intacta).
//  (K4a) El resultado de delegate_parallel pasa a stub con ≥3
//      pasos más nuevos (ventana propia), no a los 6 generales; el
//      stub declara la ventana que de verdad se le aplicó.
//  (K4b) DETENIDO TRAS MEDIRLO en esta misma construcción: la
//      sustitución en tandas (solo stubbear al juntar ≥3
//      elegibles, para romper el prefijo menos veces) costó
//      +26.071 caracteres brutos en el escenario S1 del harness
//      M4 a cambio de un beneficio condicional a que el gateway
//      honre prefijos (en vivo lee el 27-35 % del potencial). La
//      pasada sigue siendo inmediata, como en la v5.1.7; el caso
//      (K4b-detenido) lo deja fijado.
//  (K2') DEDUPE EXPEDIENTE↔MAPA POR SECCIONES (segunda pasada,
//      decisión de Lu 2026-11-14): la primera tentativa omitía el
//      bloque ENTERO del expediente en aperturas EXECUTE y rompió
//      (S8) de identidad-tarea-v516 — el expediente carga las
//      líneas de identidad «Tarea en curso:»/«Tarea anterior:»
//      (v5.1.6-S8, blindadas) que el Mapa NO destila. La variante
//      por secciones (la original de la medición M4) poda SOLO la
//      sección que el Mapa ya declara — «Decisiones:» — cuando el
//      Mapa viaja en el mismo turno EXECUTE, conservando
//      identidad, objetivo, archivos, verificados y notas. La
//      puerta dura fue (S8) SIN MODIFICAR: pasa. El carril de
//      preguntas no se toca (la puerta es EXECUTE y el expediente
//      ASK sale íntegro).
//  (K5) B1 CONSCIENTE DEL RANGO (segunda pasada, decisión de Lu
//      2026-11-14): el stub del índice del hilo solo sale si el
//      rango pedido SOLAPA la cobertura registrada; un rango
//      disjunto es información nueva y la lectura es real. El
//      invariante de la v5.1.8 se conserva: lo cubierto o solapado
//      jamás se reenvía. El corte exigió la ÚNICA re-delimitación
//      de esta versión: (B1) de correcciones-v518 — que fijaba el
//      stub por archivo afirmándolo con un rango disjunto — pasa
//      a afirmar el stub para un rango SOLAPADO, y el caso nuevo
//      (B1-bis) de esa misma batería afirma la lectura real del
//      rango disjunto, con la justificación escrita en el propio
//      test (precedente v5.1.7). Aquí el caso (K5) fija la
//      semántica a nivel del harness dueño del stub.
//  (K6) DETENIDO por la misma regla: mover la marca de
//      presupuesto de C3 del historial al mensaje del turno rompe
//      la aserción (b2) de costo-ejecucion-v517 («la marca
//      declarada viaja en el primer mensaje retenido», sobre la
//      rebanada de historial que excluye el mensaje del turno).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v519-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const {
  ChatOrchestrator,
  stubAgedToolResults,
  TOOL_STUB_SENTINEL,
  stripSharedMemoryEcho,
  SHARED_MEMORY_ECHO_HEADER,
  DELEGATE_ECHO_MARKER,
} = require("../editcore-chat-kernel/orchestrator");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const tokenHarness = require("../runtime/agent-token-harness");
const tools = require("../editcore-chat-kernel/tools");

const BASE_ARGS = {
  apiKey: ["sk", "fake", "v519"].join("-"),
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };

let callSeq = 0;
function toolCall(name, args) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// callChat falso que captura mensajes Y herramientas tal cual
// salen del kernel en cada llamada (copia profunda: el kernel muta
// los mensajes entre llamadas — stubs — y la captura debe ser la
// foto de ESA llamada).
function capturingHelpers(script, captures) {
  const queue = [...script];
  return {
    callChat: async (args) => {
      captures.push({
        messages: JSON.parse(JSON.stringify(args?.messages || [])),
        tools: JSON.parse(JSON.stringify(args?.tools || [])),
      });
      return queue.shift() || { text: "Listo.", toolCalls: [], usage: USAGE };
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

const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

// ------------------------------------------------------------ (K1-a)
test("(K1-a) slimToolDefinitions: mismo set y esquemas, descripciones a primera frase, origen intacto y byte-estable", () => {
  const raw = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true });
  const slim = tools.slimToolDefinitions(raw);
  assert.equal(slim.length, raw.length, "el set no pierde ni una herramienta");
  assert.deepEqual(
    slim.map((d) => d.function?.name),
    raw.map((d) => d.function?.name),
    "mismos nombres en el mismo orden",
  );
  // Esquemas idénticos salvo el texto de las descripciones.
  const blank = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "description" ? "" : v)));
  assert.deepEqual(blank(slim), blank(raw), "parámetros y esquemas intactos: solo cambia la prosa");
  // La dieta medida: el JSON completo baja de 20.731 a ≤15.000.
  // [REDELIMITADO A PROPÓSITO, 2026-11-16] La línea base M4 era
  // 19.340 con 34 herramientas y el tope dietado ≤14.000. Las 4
  // herramientas de documentos (create_pdf / create_word /
  // create_excel / create_csv), hechas reales por orden de Luis,
  // suman 1.391 caracteres en crudo y 685 ya dietadas: la base
  // pasa a 20.731 y el tope a ≤15.000. La dieta sigue vigente
  // (el payload baja ~29%) y byte-estable entre llamadas.
  const rawJson = JSON.stringify(raw);
  const slimJson = JSON.stringify(slim);
  assert.equal(rawJson.length, 20731, "la línea base con 38 herramientas es 20.731");
  assert.ok(slimJson.length <= 15000, `el payload de definiciones bajó a ${slimJson.length} caracteres`);
  // Primera frase exacta en los casos con historia:
  const byName = Object.fromEntries(slim.map((d) => [d.function.name, d.function]));
  assert.equal(byName.read_file.description, "Lee el contenido de un archivo.");
  assert.ok(
    byName.search_files.description.includes("p. ej. 'hero-taller.jpg', aunque sea binario)."),
    "la abreviatura «p. ej.» no corta la frase a la mitad: la primera frase sale completa",
  );
  assert.ok(byName.search_files.description.length < raw.find((d) => d.function.name === "search_files").function.description.length, "y aun así es más corta que la original");
  // Una descripción que ya es una sola frase queda byte a byte.
  assert.equal(byName.search_brain.description, raw.find((d) => d.function.name === "search_brain").function.description);
  // El origen NO se muta: las definiciones completas siguen ahí.
  assert.ok(raw.find((d) => d.function.name === "read_file").function.description.length > 200, "DEFINITIONS conserva el texto completo");
  // Byte-estable: dos pasadas producen el mismo JSON.
  assert.equal(JSON.stringify(tools.slimToolDefinitions(raw)), slimJson, "la transformación es determinista y estable entre llamadas");
});

// ------------------------------------------------------------ (K1-b)
test("(K1-b) en un turno EXECUTE real el payload lleva el set completo con descripciones cortas, idéntico entre llamadas", async () => {
  const root = emptyProject({ "package.json": PKG });
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "crea el archivo saludo.txt con el texto hola y verifica que quedó bien",
    projectRoot: root, threadId: "hilo-v519-k1",
    helpers: capturingHelpers([
      { text: "", toolCalls: [toolCall("write_file", { path: "saludo.txt", content: "hola\n" })], usage: USAGE },
      { text: "Creé saludo.txt con el saludo y verifiqué su contenido. Propongo como siguiente paso seguir con el resto de la página.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  assert.ok(captures.length >= 2, "el turno hizo sus llamadas");
  const payloadTools = captures[0].tools;
  const names = payloadTools.map((t) => t.function?.name);
  for (const expected of ["read_file", "write_file", "replace_in_file", "search_files", "delegate_parallel", "read_skill", "search_brain"]) {
    assert.ok(names.includes(expected), `el set del payload conserva ${expected} (contrato de turno: la vista no se recorta)`);
  }
  const readFile = payloadTools.find((t) => t.function?.name === "read_file");
  assert.equal(readFile.function.description, "Lee el contenido de un archivo.", "la descripción que viaja es la primera frase");
  // Tope redelimitado a 15.000 junto con la base (ver K1-a).
  assert.ok(JSON.stringify(payloadTools).length <= 15000, "el JSON de herramientas del payload quedó dietado");
  assert.equal(
    JSON.stringify(captures[1].tools), JSON.stringify(captures[0].tools),
    "las herramientas son byte-idénticas entre llamadas del turno (prefijo estable)",
  );
});

// ------------------------------------------------------------ (K3-a)
test("(K3-a) stripSharedMemoryEcho: retira el eco en sus dos formas conocidas y no toca nada más", () => {
  const eco = `${SHARED_MEMORY_ECHO_HEADER}\n- Decisión: el precio del plan Pro queda en $29 al mes\n- Estado: en curso`;
  // Forma explorer: el bloque CIERRA el informe.
  const explorerText = `## Mapa de src\n- Carpetas: src\n- Archivos: index.js\n${eco}`;
  const strippedExplorer = stripSharedMemoryEcho(explorerText);
  assert.ok(!strippedExplorer.includes("$29"), "el contenido del eco ya no está");
  assert.ok(!strippedExplorer.includes(SHARED_MEMORY_ECHO_HEADER), "el encabezado del eco ya no está");
  assert.ok(strippedExplorer.includes(DELEGATE_ECHO_MARKER), "queda la marca declarada del retiro");
  assert.ok(strippedExplorer.includes("## Mapa de src") && strippedExplorer.includes("index.js"), "la evidencia propia del explorer se conserva íntegra");
  // Forma analyst: el bloque va tras el título y lo sigue su evidencia.
  const analystText = `# Evidencia base del proyecto\n${eco}\n\n- **Raíz**: /proyecto\n- **Archivos leídos**: 3\n\n## Archivos leídos\n### src/index.js — 10 líneas`;
  const strippedAnalyst = stripSharedMemoryEcho(analystText);
  assert.ok(!strippedAnalyst.includes("$29"), "el eco del analyst también sale");
  assert.ok(strippedAnalyst.includes(DELEGATE_ECHO_MARKER), "marca declarada también en la forma analyst");
  assert.ok(strippedAnalyst.includes("- **Raíz**: /proyecto"), "la evidencia que sigue al eco se conserva");
  assert.ok(strippedAnalyst.includes("### src/index.js"), "los extractos del analyst se conservan");
  // Sin encabezado no hay nada que retirar: identidad total.
  const plain = "Informe sin memoria compartida: todo evidencia propia.";
  assert.equal(stripSharedMemoryEcho(plain), plain, "un informe sin eco sale byte a byte");
  // Forma no reconocida (eco declarado pero con más de 3.200
  // caracteres tras él): no se adivina; queda intacto.
  const unknown = `${eco}\n${"x".repeat(4000)}`;
  assert.equal(stripSharedMemoryEcho(unknown), unknown, "una forma fuera de las dos conocidas no se toca");
});

// ------------------------------------------------------------ (K3-b)
test("(K3-b) turno real con delegate_parallel: el mensaje al padre va sin eco y con su evidencia; el step conserva el informe íntegro", async () => {
  const root = emptyProject({
    "package.json": JSON.stringify({ name: "demo", scripts: { start: "node src/index.js" } }),
    "README.md": "# Taller demo\n",
    "src/index.js": "console.log('hola');\n",
  });
  threadMemory.noteDecision(root, "El precio del plan Pro queda en $29 al mes");
  const captures = [];
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    // Mensaje de TAREA (EXECUTE): el guion del modelo decide
    // delegar — como en el escenario S2 de la medición M4.
    message: "corrige el proyecto: conecta el servicio principal con la IA configurada en el .env y verifica que responde",
    projectRoot: root, threadId: "hilo-v519-k3",
    helpers: capturingHelpers([
      {
        text: "",
        toolCalls: [toolCall("delegate_parallel", {
          tasks: [
            { role: "explorer", target: "src" },
            { role: "analyst", question: "¿qué archivos clave tiene este proyecto?" },
          ],
        })],
        usage: USAGE,
      },
      { text: "Integré los informes de los subagentes: la zona src quedó mapeada y los archivos clave identificados. Propongo como siguiente paso revisar el módulo principal.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  // El mensaje tool de la delegación, tal como viajó al padre en la
  // llamada siguiente a la delegación.
  const withDelegate = captures.filter((c) => c.messages.some((m) => m.role === "tool" && m.name === "delegate_parallel"));
  assert.ok(withDelegate.length >= 1, "la delegación llegó al contexto del padre");
  const toolMsg = withDelegate[withDelegate.length - 1].messages.find((m) => m.role === "tool" && m.name === "delegate_parallel");
  assert.ok(!toolMsg.content.includes(SHARED_MEMORY_ECHO_HEADER), "el mensaje al padre NO trae el encabezado del eco");
  assert.ok(!toolMsg.content.includes("$29"), "el mensaje al padre NO recompra la memoria que ya tenía (la decisión de $29 era solo eco)");
  assert.ok(toolMsg.content.includes("Informe sin eco de memoria"), "el retiro queda declarado en el propio resultado");
  assert.ok(toolMsg.content.includes("Mapa de"), "la evidencia del explorer (su mapa) sí viaja");
  assert.ok(toolMsg.content.includes("Evidencia base del proyecto"), "la evidencia del analyst sí viaja");
  // El step — la fuente de los hechos — conserva el resultado
  // ÍNTEGRO, eco incluido (como los stubs C2: la dieta es del
  // mensaje, no del registro).
  const step = (res.steps || []).find((s) => s.name === "delegate_parallel");
  assert.ok(step, "el turno registró el step de delegación");
  assert.ok(JSON.stringify(step.result || {}).includes(SHARED_MEMORY_ECHO_HEADER), "el step conserva el informe íntegro, con su sección de memoria");
  assert.ok(JSON.stringify(step.result || {}).includes("$29"), "el step conserva también el contenido de la memoria recibida");
});

// ------------------------------------------------------------ (K4)
const stubPair = (id, name, size = 2400) => ([
  { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] },
  { role: "tool", tool_call_id: id, name, content: JSON.stringify({ ok: true, path: `${id}.js`, content: "x".repeat(size) }) },
]);
const baseMessages = () => [{ role: "system", content: "sys" }, { role: "user", content: "tarea" }];
const toolOf = (messages, id) => messages.find((m) => m.role === "tool" && m.tool_call_id === id);

test("(K4a) el resultado de delegate_parallel se stubbea a los 3 pasos (ventana propia); un read_file con 3 pasos no", () => {
  const messages = baseMessages();
  // X0..X3 lecturas viejas, D delegación, N1..N3 lecturas nuevas.
  // Pasos tras cada uno: X0=7, X1=6, X2=5, X3=4, D=3, N1=2, N2=1, N3=0.
  for (const id of ["x0", "x1", "x2", "x3"]) messages.push(...stubPair(id, "read_file"));
  messages.push(...stubPair("d0", "delegate_parallel"));
  for (const id of ["n1", "n2", "n3"]) messages.push(...stubPair(id, "read_file"));
  const stubbed = stubAgedToolResults(messages);
  assert.equal(stubbed, 3, "se stubbean los 3 elegibles: x0, x1 (ventana 6) y d0 (ventana 3 de delegación)");
  assert.ok(toolOf(messages, "d0").content.startsWith(TOOL_STUB_SENTINEL), "la delegación quedó stubbeada con solo 3 pasos más nuevos");
  assert.ok(toolOf(messages, "d0").content.includes("≥3 pasos"), "el stub de delegación declara SU ventana (≥3), no la general");
  assert.ok(!toolOf(messages, "x3").content.startsWith(TOOL_STUB_SENTINEL), "un read_file con 4 pasos más nuevos sigue íntegro (su ventana es 6)");
  assert.ok(!toolOf(messages, "x2").content.startsWith(TOOL_STUB_SENTINEL), "un read_file con 5 pasos más nuevos sigue íntegro");
});

test("(K4a-neg) una delegación con solo 2 pasos más nuevos NO se stubbea aunque otros resultados sí", () => {
  const messages = baseMessages();
  // Z0..Z2 alcanzan la ventana general; M1..M3 no; D queda a 2.
  // Pasos tras cada uno: Z0=8, Z1=7, Z2=6, M1=5, M2=4, M3=3, D=2, N1=1, N2=0.
  for (const id of ["z0", "z1", "z2", "m1", "m2", "m3"]) messages.push(...stubPair(id, "read_file"));
  messages.push(...stubPair("d0", "delegate_parallel"));
  for (const id of ["n1", "n2"]) messages.push(...stubPair(id, "read_file"));
  const stubbed = stubAgedToolResults(messages);
  assert.equal(stubbed, 3, "las tres lecturas viejas sí se stubbean");
  assert.ok(!toolOf(messages, "d0").content.startsWith(TOOL_STUB_SENTINEL), "la delegación con 2 pasos más nuevos queda ÍNTEGRA: su ventana es 3, no 2");
  assert.ok(!toolOf(messages, "m3").content.startsWith(TOOL_STUB_SENTINEL), "la lectura con 3 pasos tampoco (la ventana corta es solo de la delegación)");
});

test("(K4b-detenido) la pasada sigue siendo INMEDIATA (v5.1.7): con 2 elegibles se stubbean los 2, sin esperar tanda", () => {
  const messages = baseMessages();
  for (let k = 0; k < 8; k += 1) messages.push(...stubPair(`p${k}`, "read_file"));
  // Pasos tras cada uno: p0=7, p1=6, p2=5... → elegibles: p0 y p1 (2).
  // La tanda de K4b los habría retenido hasta juntar un tercero;
  // quedó detenida por su costo bruto medido (+26.071 en S1).
  assert.equal(stubAgedToolResults(messages), 2, "los 2 elegibles se stubbean en la misma pasada, como en la v5.1.7");
  assert.ok(toolOf(messages, "p0").content.startsWith(TOOL_STUB_SENTINEL));
  assert.ok(toolOf(messages, "p1").content.startsWith(TOOL_STUB_SENTINEL));
  assert.ok(!toolOf(messages, "p2").content.startsWith(TOOL_STUB_SENTINEL), "el resto sigue íntegro");
  assert.equal(stubAgedToolResults(messages), 0, "la segunda pasada no re-stubbea (una sola sustitución por resultado)");
});

// ------------------------------------------------------------ (K2')
const K2_DECISION = "El Asesor IA responde siempre con el catálogo real de la base de datos";

// Proyecto con expediente Y Mapa poblados con la MISMA decisión:
// el duplicado exacto que K2' viene a podar en aperturas EXECUTE.
function seedK2Project() {
  const root = emptyProject({
    "package.json": JSON.stringify({ name: "demo" }),
    "app.py": "def main():\n    pass\n",
    "templates/ai_agent.html": "<div id=\"chat\"></div>\n",
  });
  threadMemory.saveProjectState(root, {
    objective: "Sitio de ALFA LUBES con Asesor IA conectado al catálogo real de productos.",
    workingOn: "conexión del Asesor IA",
    decisions: [{ t: Date.now(), text: K2_DECISION }],
    notes: [{ t: Date.now(), text: "Queda registrado el estado del endpoint y su verificación previa en el expediente." }],
    files: [{ rel: "app.py", action: "modified", at: Date.now() }],
    verified: [{ t: Date.now(), text: "El preview local renderiza y el endpoint existe en app.py" }],
    discarded: [],
    facts: [],
    fronts: [],
  });
  orientationMap.saveProjectMap(root, {
    version: 1,
    purpose: "Sitio ALFA LUBES: Asesor IA con catálogo real y cierre de venta.",
    state: "[2026-11-14] Aplicado: correcciones previas de app.py · Verificación: preview local OK",
    decisions: [{ text: K2_DECISION, at: "2026-11-13", source: "expediente del proyecto" }],
    openFronts: [{ text: "Frente: conectar el Asesor IA con la IA del .env y el catálogo real", at: "2026-11-13", source: "informe de subagente" }],
    closedFronts: [],
    keyFiles: [{ file: "app.py", role: "contiene el endpoint /api/ai-chat" }],
  });
  return root;
}

// El segmento del expediente dentro del mensaje del turno de la
// PRIMERA llamada capturada: del encabezado del expediente al
// encabezado del Mapa (o al fin del contexto si el Mapa no viaja
// en ese carril).
function dossierSegment(captures) {
  const msgs = captures[0]?.messages || [];
  const turn = [...msgs].reverse().find((m) => m.role === "user" && typeof m.content === "string");
  const text = turn?.content || "";
  const i = text.indexOf("EXPEDIENTE DEL PROYECTO");
  assert.ok(i >= 0, "el expediente viaja en el mensaje del turno");
  const j = text.indexOf("MAPA DE ORIENTACIÓN");
  const end = j > i ? j : text.indexOf("=== FIN CONTEXTO ===");
  return { segment: text.slice(i, end > i ? end : undefined), full: text };
}

test("(K2') apertura EXECUTE con Mapa viajando: el expediente sale SIN la sección de decisiones (ya está en el Mapa) y CON la línea de identidad «Tarea anterior:»", async () => {
  const root = seedK2Project();
  // Turno 1: la tarea original (deja workingOn y, al retomarla, el
  // antecedente «Tarea anterior:» en el expediente del hilo).
  const captures1 = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "conecta app.py con templates/ai_agent.html para completar el Asesor IA",
    projectRoot: root, threadId: "hilo-v519-k2p",
    helpers: capturingHelpers([
      { text: "", toolCalls: [toolCall("write_file", { path: "app.py", content: "def main():\n    pass\n\n# conectado con templates/ai_agent.html\n" })], usage: USAGE },
      { text: "Doy por terminado el encargo porque app.py quedó conectado con la plantilla del asesor. Propongo como siguiente paso probar el chat en el preview.", toolCalls: [], usage: USAGE },
    ], captures1),
  });
  // Turno 2 (EXECUTE): la anáfora — el escenario exacto de (S8).
  const captures2 = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "retoma la tarea anterior y ejecútala completa",
    projectRoot: root, threadId: "hilo-v519-k2p",
    helpers: capturingHelpers([
      { text: "", toolCalls: [toolCall("write_file", { path: "app.py", content: "def main():\n    pass\n\n# conectado con templates/ai_agent.html\n# frente completado\n" })], usage: USAGE },
      { text: "Doy por terminado el encargo porque el frente del Asesor IA quedó ejecutado completo en app.py. Propongo como siguiente paso probar el chat en el preview.", toolCalls: [], usage: USAGE },
    ], captures2),
  });
  const { segment, full } = dossierSegment(captures2);
  // La poda: la sección duplicada no está en el expediente…
  assert.ok(!segment.includes("Decisiones:"), "la sección «Decisiones:» del expediente NO viaja en EXECUTE: el Mapa la declara");
  assert.ok(!segment.includes(K2_DECISION), "el texto de la decisión no se paga dos veces en el mismo turno");
  // …y la decisión sigue presente, una sola vez, en el Mapa.
  assert.ok(full.includes("Decisiones vigentes"), "el Mapa del turno declara las decisiones vigentes");
  assert.ok(full.includes(K2_DECISION), "la decisión viaja en el Mapa");
  // Lo conservado: identidad y las secciones que el Mapa no declara.
  assert.ok(segment.includes("Tarea anterior:"), "la línea del antecedente (identidad v5.1.6-S8) SIGUE viajando en el expediente");
  assert.ok(segment.includes("conecta app.py con templates/ai_agent.html"), "el antecedente mostrado es el texto literal del primer turno");
  assert.ok(segment.includes("Objetivo:"), "el objetivo se conserva");
  assert.ok(segment.includes("Notas:"), "las notas se conservan");
  assert.ok(segment.includes("Archivos clave:"), "los archivos se conservan");
  assert.ok(segment.includes("Verificado en vivo"), "lo verificado se conserva");
});

test("(K2'-b) apertura ASK sin cambios: el expediente sale ÍNTEGRO, con su sección de decisiones (la puerta de K2' es solo EXECUTE)", async () => {
  const root = seedK2Project();
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "¿dónde se lee la clave de la IA en app.py?",
    projectRoot: root, threadId: "hilo-v519-k2p-ask",
    helpers: capturingHelpers([
      { text: "", toolCalls: [toolCall("read_file", { path: "app.py", startLine: 1, endLine: 10 })], usage: USAGE },
      { text: "La clave de la IA se lee al inicio de app.py, desde las variables de entorno, con su respaldo configurado.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  const { segment } = dossierSegment(captures);
  assert.ok(segment.includes("Decisiones:"), "en ASK la sección de decisiones del expediente viaja como siempre");
  assert.ok(segment.includes(K2_DECISION), "en ASK la decisión viaja en el expediente, byte a byte como en la v5.1.8");
  // Y a nivel de función: sin flag no hay poda; con flag, solo ella.
  const full = threadMemory.projectPromptBlock(root, "hilo-v519-k2p-ask", "asesor");
  assert.ok(full.includes("Decisiones:") && full.includes(K2_DECISION), "projectPromptBlock sin flag emite el bloque completo");
  const pruned = threadMemory.projectPromptBlock(root, "hilo-v519-k2p-ask", "asesor", { omitMapSections: true });
  assert.ok(!pruned.includes("Decisiones:") && !pruned.includes(K2_DECISION), "con omitMapSections la sección de decisiones no se emite");
  assert.ok(pruned.includes("Objetivo:") && pruned.includes("Notas:") && pruned.includes("Archivos clave:") && pruned.includes("Verificado en vivo"), "la poda conserva objetivo, notas, archivos y verificados");
});

// ------------------------------------------------------------ (K5)
test("(K5) threadReadStub consciente del rango: solapado→stub, disjunto→null (lectura real), sin rango→stub, force:true→null", () => {
  const lines = [];
  for (let i = 1; i <= 60; i += 1) lines.push(`# relleno ${i}`);
  const root = emptyProject({ "package.json": PKG, "app.py": `${lines.join("\n")}\n` });
  const threadId = "hilo-v519-k5";
  // Una lectura real 1-10 alimenta el índice del hilo (huella real
  // de disco, como hace el orquestador tras despachar read_file).
  tokenHarness.noteThreadRead(root, threadId, "app.py", { startLine: 1, endLine: 10 }, { totalLines: 60 });
  // Solapado (5-15 toca 1-10): stub, y declara la cobertura.
  const stub = tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 5, endLine: 15 });
  assert.ok(stub?.threadReadStub === true, "un rango solapado con la cobertura devuelve el stub del hilo");
  assert.ok(String(stub.note || "").includes("1-10"), "el stub declara los rangos ya cubiertos");
  assert.ok(String(stub.note || "").includes("force:true"), "el stub declara la vía de escape");
  // Disjunto (40-60 no toca 1-10): null — la lectura será REAL.
  // Es el refinamiento de K5: información nueva no se castiga con
  // el desvío stub→búsqueda→force:true que midió M4.
  assert.strictEqual(
    tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 40, endLine: 60 }),
    null,
    "un rango disjunto (jamás leído) no devuelve stub: la lectura es real",
  );
  // Sin rango explícito el pedido es el archivo entero: solapa
  // cualquier cobertura y el stub manda, como en la v5.1.8.
  assert.ok(tokenHarness.threadReadStub(root, threadId, "app.py")?.threadReadStub === true, "sin rango (archivo entero) el stub sigue saliendo");
  // force:true: null siempre, haya o no cobertura.
  assert.strictEqual(
    tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 5, endLine: 15, force: true }),
    null,
    "con force:true nunca hay stub",
  );
  // La cobertura crece con cada lectura real: tras leer 40-60, ese
  // rango pasa a stubbear (el invariante: lo cubierto no se repite).
  tokenHarness.noteThreadRead(root, threadId, "app.py", { startLine: 40, endLine: 60 }, { totalLines: 60 });
  assert.ok(
    tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 45, endLine: 55 })?.threadReadStub === true,
    "tras la lectura real del rango disjunto, releer DENTRO de él vuelve a ser stub",
  );
});
